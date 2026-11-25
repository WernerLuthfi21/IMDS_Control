import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { enqueuePartMasterRows, dispatchPartMasterOutbox } from "@/lib/imds-master/outbox";
import { modelKeyOf, parseParts, splitPaste, toInserts, type AddContext, type ExistingRow } from "@/lib/imds-master/part-add";
import { normPartNo } from "@/lib/imds-master/part-log";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = { mode?: "preview" | "commit"; text?: string; company?: string; model?: string; status?: string };

/**
 * Add part numbers to one supplier by pasting rows. mode "preview": what was recognised, what the system fills in
 * (vendor code, PIC e-mail, model, status, plan date) and what is wrong. mode "commit": inserts the rows without
 * errors into the shared master (same KEY formula as the master import) and queues them for the Excel master.
 */
export async function POST(request: NextRequest) {
  const auth = await getAuthContext();
  if (!auth.userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!["admin", "preparer", "reviewer"].includes(auth.role || "")) return NextResponse.json({ error: "Admin, preparer or reviewer role is required to add parts." }, { status: 403 });
  const body = await request.json().catch(() => null) as Body | null;
  const company = String(body?.company || "").trim().slice(0, 200);
  if (!company) return NextResponse.json({ error: "Open a supplier first." }, { status: 400 });
  const text = String(body?.text || "").slice(0, 400_000);
  if (!splitPaste(text).length) return NextResponse.json({ error: "Paste at least one row." }, { status: 400 });
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });

  // Supplier context from its existing rows: vendor code and PIC e-mail (most used), plus all models in the master.
  const { data: own } = await supabase.from("imds_master_parts").select("vendor_code,main_pic_email").eq("company_name", company).limit(3000);
  const most = (vals: (string | null | undefined)[]) => { const c = new Map<string, number>(); vals.forEach((v) => { const t = String(v || "").trim(); if (t) c.set(t, (c.get(t) || 0) + 1); }); return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || ""; };
  const models = new Set<string>();
  for (let from = 0; from < 60000; from += 1000) {
    const { data } = await supabase.from("imds_master_parts").select("project").not("project", "is", null).range(from, from + 999);
    (data || []).forEach((r: { project?: string | null }) => { const k = modelKeyOf(r.project); if (k) models.add(k); });
    if (!data || data.length < 1000) break;
  }
  const { data: dueRow } = await supabase.from("imds_tracker_settings").select("value").eq("key", "due_dates").maybeSingle();
  const ctx: AddContext = {
    company, vendorCode: most((own || []).map((r: { vendor_code?: string | null }) => r.vendor_code)), email: most((own || []).map((r: { main_pic_email?: string | null }) => r.main_pic_email)),
    models: [...models], defaultModel: modelKeyOf(body?.model), defaultStatus: String(body?.status || "NOT SUBMITTED YET").toUpperCase().slice(0, 40),
    due: (dueRow?.value || {}) as AddContext["due"]
  };

  // Existing master rows with the same part numbers (any supplier), for duplicates and cross-supplier warnings.
  const norms = [...new Set(splitPaste(text).flat().map(normPartNo).filter((n) => n.length >= 5))].slice(0, 3000);
  const existing: ExistingRow[] = [];
  for (let i = 0; i < norms.length; i += 300) {
    const { data, error } = await supabase.from("imds_master_parts").select("id,company_name,project,part_no,part_no_norm").in("part_no_norm", norms.slice(i, i + 300));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    existing.push(...((data || []) as ExistingRow[]));
  }
  const parsed = parseParts(text, ctx, existing);
  const supplier = { company, vendorCode: ctx.vendorCode, email: ctx.email };
  if (body?.mode !== "commit") return NextResponse.json({ ...parsed, supplier, models: ctx.models.sort() }, { headers: { "Cache-Control": "no-store" } });

  const inserts = toInserts(parsed.rows, ctx, auth.userId, new Date());
  if (!inserts.length) return NextResponse.json({ error: "No row can be added (see the problems in the preview).", ...parsed }, { status: 422 });
  const added: Record<string, unknown>[] = [];
  for (let i = 0; i < inserts.length; i += 200) {
    const { data, error } = await supabase.from("imds_master_parts").insert(inserts.slice(i, i + 200)).select("*");
    if (error) {
      const dup = /duplicate|unique/i.test(error.message);
      return NextResponse.json({ error: dup ? "One of these part numbers was just added by someone else. Refresh and try again." : error.message, added: added.length }, { status: dup ? 409 : 500 });
    }
    added.push(...((data || []) as Record<string, unknown>[]));
  }
  await supabase.from("audit_events").insert({ actor_id: auth.userId, action: "IMDS_MASTER_PARTS_ADDED", entity_type: "imds_master_part", metadata: { company, count: added.length, partNos: added.map((r) => r.part_no).slice(0, 200) } });
  let powerAutomate;
  try { await enqueuePartMasterRows(supabase, auth.userId, added, "tracker_add_parts"); powerAutomate = await dispatchPartMasterOutbox(supabase, 10); }
  catch (e) { powerAutomate = { error: e instanceof Error ? e.message : "Excel sync could not be queued." }; }
  return NextResponse.json({ added: added.length, skipped: parsed.rows.length - added.length, powerAutomate });
}
