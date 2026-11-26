import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isDue, noticeFor, wibSlot } from "@/lib/followup/schedule";
import { loadContext, runAutomation } from "@/lib/followup/scheduled-run";
import { sendNotice, summarize } from "@/lib/followup/automation-notice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Admin = NonNullable<ReturnType<typeof createAdminClient>>;
/** Claim a slot once: the first claim row wins; a retried invocation stops. */
async function claim(db: Admin, slot: string): Promise<boolean> {
  const { data: mine } = await db.from("audit_events").insert({ actor_id: null, action: "IMDS_FOLLOWUP_SCHEDULE_CLAIM", entity_type: "imds_tracker_schedule", metadata: { slot } }).select("id").single();
  const { data: first } = await db.from("audit_events").select("id").eq("action", "IMDS_FOLLOWUP_SCHEDULE_CLAIM").eq("metadata->>slot", slot).order("created_at", { ascending: true }).limit(1);
  return Boolean(mine && first && first[0] && first[0].id === mine.id);
}

/**
 * Automatic follow-ups. Vercel Cron calls this once in every hour of the day (vercel.json: 24 daily jobs; the Hobby
 * plan allows daily jobs only, each within its hour) with `Authorization: Bearer $CRON_SECRET`. For every switched-on
 * automation it sends the reminder to the TMMIN PIC `leadHours` before a run, and the run itself on its WIB slot,
 * each once. Without CRON_SECRET and the service-role key it does nothing.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set; automations are off." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const db = createAdminClient();
  if (!db) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set; automations cannot read the master." }, { status: 503 });
  const now = new Date(), slot = wibSlot(now).key, done: unknown[] = [];
  const started = Date.now(), totalBudget = 240_000;
  let ctx;
  try { ctx = await loadContext(db); } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
  for (const a of ctx.cfg.automations) {
    try {
      if (Date.now() - started > totalBudget - 30_000) { done.push({ automation:a.id, skipped:"Global scheduler time budget exhausted; review before rescheduling." }); continue; }
      const runAt = noticeFor(a, now);
      if (runAt && await claim(db, `notice:${a.id}@${wibSlot(runAt).key}`)) {
        const preview = await runAutomation(db, a, { now: runAt, dryRun: true, actorId: null, slot: wibSlot(runAt).key }, ctx);
        const n = await sendNotice(a, preview, runAt);
        await db.from("audit_events").insert({ actor_id: null, action: "IMDS_FOLLOWUP_SCHEDULE_NOTICE", entity_type: "imds_tracker_schedule", metadata: { automation: a.id, name: a.name, runSlot: wibSlot(runAt).key, to: n.to, ok: n.ok, error: n.error || null, emails: preview.planned.filter((p) => !p.skip).length } });
        done.push({ automation: a.id, notice: n.ok });
      }
      if (isDue(a, now) && Date.now()-started > totalBudget-30_000) { done.push({automation:a.id,skipped:"Global scheduler time budget exhausted; review before rescheduling."}); continue; }
      if (isDue(a, now) && await claim(db, `${a.id}@${slot}`)) {
        const r = await runAutomation(db, a, { now, dryRun: false, actorId: null, budgetMs: Math.max(0,totalBudget-(Date.now()-started)) }, ctx);
        await db.from("audit_events").insert({ actor_id: null, action: "IMDS_FOLLOWUP_SCHEDULE_RUN", entity_type: "imds_tracker_schedule", metadata: summarize(a, r, false) });
        done.push({ automation: a.id, sent: r.sent, failed: r.failed, skipped: r.skipped });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await db.from("audit_events").insert({ actor_id: null, action: "IMDS_FOLLOWUP_SCHEDULE_RUN", entity_type: "imds_tracker_schedule", metadata: { automation: a.id, name: a.name, slot, error: message } });
      done.push({ automation: a.id, error: message });
    }
  }
  return NextResponse.json({ slot, automations: ctx.cfg.automations.length, done });
}
