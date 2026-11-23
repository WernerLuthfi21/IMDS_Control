import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_CONFIG, sanitizeConfig } from "@/lib/followup/center";
import { nextRuns, sanitizeSchedule, wibSlot } from "@/lib/followup/schedule";
import { runScheduledFollowups } from "@/lib/followup/scheduled-run";
import { TEAM } from "@/lib/followup/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Settings → Automatic follow-up: readiness, next runs and the last runs. */
export async function GET() {
  const auth = await getAuthContext();
  if (!auth.userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!["admin", "preparer", "reviewer"].includes(auth.role || "")) return NextResponse.json({ error: "Preparer, reviewer or admin role required." }, { status: 403 });
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const { data } = await supabase.from("imds_tracker_settings").select("value").eq("key", "followup_config").maybeSingle();
  const cfg = sanitizeConfig(data?.value ?? DEFAULT_CONFIG), now = new Date();
  const admin = createAdminClient();
  const { data: runs } = await (admin || supabase).from("audit_events").select("created_at,metadata").eq("action", "IMDS_FOLLOWUP_SCHEDULE_RUN").order("created_at", { ascending: false }).limit(8);
  const flowUrl = /^https:\/\//i.test(process.env.POWER_AUTOMATE_EMAIL_URL?.trim() || ""), flowSecret = Boolean(process.env.POWER_AUTOMATE_SECRET?.trim());
  return NextResponse.json({
    schedule: cfg.schedule, team: Object.keys(TEAM), now: now.toISOString(), slot: wibSlot(now).key,
    next: nextRuns(cfg.schedule, now, 3).map((d) => d.toISOString()),
    ready: { cron: Boolean(process.env.CRON_SECRET?.trim()), serviceKey: Boolean(admin), flow: flowUrl && flowSecret },
    runs: (runs || []).map((r) => ({ at: r.created_at, ...(r.metadata as Record<string, unknown>) })),
    canRun: ["admin", "preparer"].includes(auth.role || "")
  }, { headers: { "Cache-Control": "private, no-store" } });
}

/** {action:"preview"} = what the next run would send (nothing is sent). {action:"run-now"} = send now (admin / preparer). */
export async function POST(request: NextRequest) {
  const auth = await getAuthContext();
  if (!auth.userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const body = await request.json().catch(() => null) as { action?: string; schedule?: unknown } | null;
  const run = body?.action === "run-now";
  if (!["admin", "preparer"].includes(auth.role || "") && (run || !["reviewer"].includes(auth.role || ""))) return NextResponse.json({ error: run ? "Admin or preparer role is required to send." : "Preparer, reviewer or admin role required." }, { status: 403 });
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const now = new Date();
  // Preview may use the settings on screen (not saved yet); run-now always uses the saved settings.
  const schedule = !run && body?.schedule ? sanitizeSchedule(body.schedule) : undefined;
  try {
    const r = await runScheduledFollowups(supabase, { now, dryRun: !run, actorId: auth.userId, budgetMs: 250_000, schedule });
    if (run) await supabase.from("audit_events").insert({ actor_id: auth.userId, action: "IMDS_FOLLOWUP_SCHEDULE_RUN", entity_type: "imds_tracker_schedule", metadata: { slot: wibSlot(now).key, manual: true, sent: r.sent, failed: r.failed, skipped: r.skipped, note: r.note || null, suppliers: r.planned.map((p) => ({ s: p.supplier, n: p.parts, st: p.status || "PLANNED", e: p.error || p.skip || null })).slice(0, 300) } });
    return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
