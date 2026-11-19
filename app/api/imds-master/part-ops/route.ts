import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { enqueuePartMasterRows, dispatchPartMasterOutbox } from "@/lib/imds-master/outbox";
import { groupUpdates, planPartOps, sanitizePartLog, validate, type Action, type MasterRow, type Options, type PartLog } from "@/lib/imds-master/part-log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LOG_KEY = "part_log";
const LOG_HINT = "The Check tab and the Stop run log are not enabled yet: run supabase/migrations/20261119020000_tracker_part_log.sql once in the Supabase SQL editor. Nothing was changed.";
const COLUMNS = "id,master_key,company_name,vendor_code,project,part_no,part_name,imds_status,submission_plan,main_pic_email,manual_overrides";

type Db = NonNullable<Awaited<ReturnType<typeof createClient>>>;

async function readLog(supabase: Db): Promise<{ log: PartLog; version: number }> {
  const { data, error } = await supabase.from("imds_tracker_settings").select("value,version").eq("key", LOG_KEY).maybeSingle();
  if (error) throw new Error(error.message);
  return { log: sanitizePartLog(data?.value), version: Number(data?.version || 0) };
}
/** Optimistic write: false when someone else saved in between (the caller re-reads and re-plans). */
async function writeLog(supabase: Db, userId: string, log: PartLog, base: number): Promise<boolean> {
  if (base === 0) {
    const { error } = await supabase.from("imds_tracker_settings").insert({ key: LOG_KEY, value: log, version: 1, updated_by: userId });
    if (!error) return true;
    if (/duplicate|unique/i.test(error.message)) return false;
    throw new Error(error.message);
  }
  const { data, error } = await supabase.from("imds_tracker_settings")
    .update({ value: log, version: base + 1, updated_by: userId, updated_at: new Date().toISOString() })
    .eq("key", LOG_KEY).eq("version", base).select("version");
  if (error) throw new Error(error.message);
  return Boolean(data?.length);
}

/**
 * One endpoint for the Tracker's part operations, so every change is planned by the same tested rules
 * (lib/imds-master/part-log.ts), written to the master with manual_overrides, audited, and queued for the Excel sync:
 *   set-target  submission_plan for many parts (a model or supplier due date applied to all its parts, or one part)
 *   to-check    move to the Check tab (IMDS STATUS = CHECK), remembering who the part belonged to
 *   resolve     back to the Tracker with the correct supplier and/or model, status restored
 *   stop-run    IMDS STATUS = STOP RUN, last identity kept in the log
 *   restore     undo a Stop run
 */
export async function POST(request: NextRequest) {
  const auth = await getAuthContext();
  if (!auth.configured) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  if (!auth.userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!["admin", "preparer", "reviewer"].includes(auth.role || "")) {
    return NextResponse.json({ error: "Admin, preparer or reviewer role is required to change master data." }, { status: 403 });
  }
  const body = await request.json().catch(() => null) as ({ action?: string; ids?: unknown } & Options) | null;
  if (!body) return NextResponse.json({ error: "A JSON body is required." }, { status: 400 });
  const action = String(body.action || "") as Action;
  const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(String))];
  const opts: Options = { reason: body.reason, date: body.date, company: body.company, vendorCode: body.vendorCode, email: body.email, model: body.model, status: body.status };
  const invalid = validate(action, ids, opts);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 422 });

  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });

  const rows: (MasterRow & { manual_overrides?: unknown })[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from("imds_master_parts").select(COLUMNS).in("id", ids.slice(i, i + 200));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    rows.push(...((data || []) as unknown as (MasterRow & { manual_overrides?: unknown })[]));
  }
  if (!rows.length) return NextResponse.json({ error: "Those parts are no longer in the master. Refresh the Tracker." }, { status: 404 });

  const by = auth.email || auth.userId;
  let plan = planPartOps(action, rows, { checks: {}, events: [] }, opts, by, new Date());
  if (action !== "set-target") {
    // Log first: if it cannot be saved (migration missing, conflict), nothing in the master changes.
    let saved = false;
    for (let attempt = 0; attempt < 3 && !saved; attempt++) {
      let current;
      try { current = await readLog(supabase); } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Could not read the part log." }, { status: 500 }); }
      plan = planPartOps(action, rows, current.log, opts, by, new Date());
      if (!plan.logChanged) { saved = true; break; }
      try { saved = await writeLog(supabase, auth.userId, plan.log, current.version); }
      catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/check constraint|violates|schema cache|does not exist/i.test(msg)) return NextResponse.json({ error: LOG_HINT, migrationNeeded: true }, { status: 503 });
        return NextResponse.json({ error: msg }, { status: 500 });
      }
    }
    if (!saved) return NextResponse.json({ error: "Someone else changed the Check list at the same moment. Try again.", conflict: true }, { status: 409 });
  }
  if (!plan.updates.length) return NextResponse.json({ updated: 0, log: plan.log, note: "Nothing to change." });

  const overrides = new Map(rows.map((r) => [r.id, Array.isArray(r.manual_overrides) ? (r.manual_overrides as unknown[]).map(String) : []]));
  const changedIds: string[] = [];
  for (const g of groupUpdates(plan.updates, (id) => overrides.get(id) || [])) {
    for (let i = 0; i < g.ids.length; i += 200) {
      const chunk = g.ids.slice(i, i + 200);
      const { error } = await supabase.from("imds_master_parts").update({ ...g.patch, updated_by: auth.userId }).in("id", chunk);
      if (error) return NextResponse.json({ error: `Saved ${changedIds.length} part(s), then failed: ${error.message}`, updated: changedIds.length }, { status: 409 });
      changedIds.push(...chunk);
    }
  }

  await supabase.from("audit_events").insert({
    actor_id: auth.userId, action: "IMDS_MASTER_PART_OPS", entity_type: "imds_master_part", entity_id: changedIds.length === 1 ? changedIds[0] : null,
    metadata: { op: action, parts: changedIds.length, reason: opts.reason || null, date: opts.date ?? null, company: opts.company || null, model: opts.model || null, status: opts.status || null },
  });

  let powerAutomate;
  try {
    const fresh: Record<string, unknown>[] = [];
    for (let i = 0; i < changedIds.length; i += 200) {
      const { data } = await supabase.from("imds_master_parts").select("*").in("id", changedIds.slice(i, i + 200));
      fresh.push(...((data || []) as Record<string, unknown>[]));
    }
    await enqueuePartMasterRows(supabase, auth.userId, fresh, "tracker_part_ops");
    powerAutomate = await dispatchPartMasterOutbox(supabase, 10);
  } catch (syncError) {
    powerAutomate = { configured: Boolean(process.env.POWER_AUTOMATE_TRACKER_URL?.trim()), sent: 0, failed: 0, pending: 1, error: syncError instanceof Error ? syncError.message : "Excel sync could not be queued." };
  }
  return NextResponse.json({ updated: changedIds.length, log: action === "set-target" ? undefined : plan.log, powerAutomate }, { headers: { "Cache-Control": "no-store" } });
}
