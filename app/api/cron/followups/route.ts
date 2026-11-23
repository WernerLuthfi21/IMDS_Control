import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_CONFIG, sanitizeConfig } from "@/lib/followup/center";
import { isDue, wibSlot } from "@/lib/followup/schedule";
import { runScheduledFollowups } from "@/lib/followup/scheduled-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Weekly automatic follow-up. Vercel Cron calls this once in every hour of the day (vercel.json: 24 daily jobs,
 * the Hobby plan allows daily jobs only and runs each within its hour) with `Authorization: Bearer $CRON_SECRET`.
 * It sends only when the WIB day and hour match Settings → E-mail templates → Automatic follow-up, and only once
 * per slot (an audit row claims the slot first). Without CRON_SECRET and the service-role key it does nothing.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set; the schedule is off." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const db = createAdminClient();
  if (!db) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set; the schedule cannot read the master." }, { status: 503 });

  const now = new Date(), slot = wibSlot(now);
  const { data: cfgRow } = await db.from("imds_tracker_settings").select("value").eq("key", "followup_config").maybeSingle();
  const cfg = sanitizeConfig(cfgRow?.value ?? DEFAULT_CONFIG);
  if (!isDue(cfg.schedule, now)) return NextResponse.json({ ran: false, slot: slot.key, reason: cfg.schedule.enabled ? "Not a scheduled day/hour." : "The schedule is switched off." });

  // Claim the slot: the first claim row for this slot wins, a second (retried) invocation stops here.
  const { data: claim } = await db.from("audit_events").insert({ actor_id: null, action: "IMDS_FOLLOWUP_SCHEDULE_CLAIM", entity_type: "imds_tracker_schedule", metadata: { slot: slot.key } }).select("id,created_at").single();
  const { data: first } = await db.from("audit_events").select("id").eq("action", "IMDS_FOLLOWUP_SCHEDULE_CLAIM").eq("metadata->>slot", slot.key).order("created_at", { ascending: true }).limit(1);
  if (!claim || (first && first[0] && first[0].id !== claim.id)) return NextResponse.json({ ran: false, slot: slot.key, reason: "This slot already ran." });

  try {
    const r = await runScheduledFollowups(db, { now, dryRun: false, actorId: null, budgetMs: 250_000 });
    await db.from("audit_events").insert({ actor_id: null, action: "IMDS_FOLLOWUP_SCHEDULE_RUN", entity_type: "imds_tracker_schedule", metadata: { slot: slot.key, sent: r.sent, failed: r.failed, skipped: r.skipped, note: r.note || null, suppliers: r.planned.map((p) => ({ s: p.supplier, n: p.parts, st: p.status || "PLANNED", e: p.error || p.skip || null })).slice(0, 300) } });
    return NextResponse.json({ ran: true, slot: slot.key, sent: r.sent, failed: r.failed, skipped: r.skipped, note: r.note });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.from("audit_events").insert({ actor_id: null, action: "IMDS_FOLLOWUP_SCHEDULE_RUN", entity_type: "imds_tracker_schedule", metadata: { slot: slot.key, error: message } });
    return NextResponse.json({ ran: false, slot: slot.key, error: message }, { status: 500 });
  }
}
