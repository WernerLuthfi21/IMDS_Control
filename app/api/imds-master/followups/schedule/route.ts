import { NextRequest, NextResponse } from "next/server";
import { sameOrigin } from "@/lib/security/request";
import { getAuthContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { describe, nextRuns, noticeFor, sanitizeAutomation, wibSlot } from "@/lib/followup/schedule";
import { draftFor, loadContext, runAutomation } from "@/lib/followup/scheduled-run";
import { noticeTo, sendNotice, summarize } from "@/lib/followup/automation-notice";
import { listLibrary } from "@/lib/followup/library";
import { TEAM } from "@/lib/followup/render";
import { buildEml, emlFileName } from "@/lib/followup/eml";
import { toHtml } from "@/lib/followup/payload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Follow-up → Automatic: automations with their next runs and reminders, readiness, file library and last runs. */
export async function GET() {
  const auth = await getAuthContext();
  if (!auth.userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!["admin", "preparer", "reviewer"].includes(auth.role || "")) return NextResponse.json({ error: "Preparer, reviewer or admin role required." }, { status: 403 });
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const ctx = await loadContext(supabase).catch(() => null);
  const now = new Date(), admin = createAdminClient();
  const { data: runs } = await (admin || supabase).from("audit_events").select("action,created_at,metadata").in("action", ["IMDS_FOLLOWUP_SCHEDULE_RUN", "IMDS_FOLLOWUP_SCHEDULE_NOTICE"]).order("created_at", { ascending: false }).limit(30);
  const flow = /^https:\/\//i.test(process.env.POWER_AUTOMATE_EMAIL_URL?.trim() || "") && Boolean(process.env.POWER_AUTOMATE_SECRET?.trim());
  const automations = (ctx?.cfg.automations || []).map((a) => {
    const next = nextRuns(a, now, 3);
    return { ...a, describe: describe(a), next: next.map((d) => d.toISOString()), noticeAt: a.notify.enabled && next[0] ? new Date(next[0].getTime() - a.notify.leadHours * 3600000).toISOString() : null, noticeTo: noticeTo(a), nextSlot: next[0] ? wibSlot(next[0]).key : "" };
  });
  return NextResponse.json({
    automations, templates: (ctx?.cfg.templates || []).map((t) => ({ id: t.id, kind: t.kind, name: t.name })), defaults: ctx?.cfg.defaults || {},
    team: Object.entries(TEAM).map(([name, email]) => ({ name, email })), library: ctx ? listLibrary(ctx.lib) : [],
    now: now.toISOString(), ready: { cron: Boolean(process.env.CRON_SECRET?.trim()), serviceKey: Boolean(admin), flow },
    runs: (runs || []).map((r) => ({ kind: r.action === "IMDS_FOLLOWUP_SCHEDULE_NOTICE" ? "notice" : "run", at: r.created_at, ...(r.metadata as Record<string, unknown>) })),
    canRun: ["admin", "preparer"].includes(auth.role || ""), noticeNow: (ctx?.cfg.automations || []).some((a) => noticeFor(a, now) !== null)
  }, { headers: { "Cache-Control": "private, no-store" } });
}

/**
 * {action:"preview", automation}            what the next run would send, with every e-mail's text (nothing is sent)
 * {action:"draft", automation, supplier}     that e-mail as an Outlook draft (.eml) with its real attachments
 * {action:"notice-test", automation}         sends the reminder now, only to the TMMIN PIC(s) of the automation
 * {action:"run-now", id}                     sends the SAVED automation now (admin / preparer)
 * Preview, draft and notice-test may use the automation on screen (not saved yet).
 */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request.headers)) return NextResponse.json({ error: "Request origin rejected." }, { status: 403 });
  const auth = await getAuthContext();
  if (!auth.userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const body = await request.json().catch(() => null) as { action?: string; automation?: unknown; supplier?: string; id?: string } | null;
  const action = String(body?.action || "");
  const editor = ["admin", "preparer"].includes(auth.role || "");
  if (!editor && !(auth.role === "reviewer" && (action === "preview" || action === "draft"))) return NextResponse.json({ error: "Admin or preparer role is required." }, { status: 403 });
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const now = new Date();
  try {
    const ctx = await loadContext(supabase);
    if (action === "run-now") {
      const a = ctx.cfg.automations.find((x) => x.id === body?.id);
      if (!a) return NextResponse.json({ error: "Save the automation first." }, { status: 404 });
      const r = await runAutomation(supabase, a, { now, dryRun: false, actorId: auth.userId, budgetMs: 250_000 }, ctx);
      await supabase.from("audit_events").insert({ actor_id: auth.userId, action: "IMDS_FOLLOWUP_SCHEDULE_RUN", entity_type: "imds_tracker_schedule", metadata: summarize(a, r, true) });
      return NextResponse.json(r);
    }
    const a = sanitizeAutomation(body?.automation);
    const runAt = nextRuns({ ...a, enabled: true }, now, 1)[0] || now;
    if (action === "preview") return NextResponse.json({ ...(await runAutomation(supabase, a, { now: runAt, dryRun: true, actorId: auth.userId, withBodies: true, slot: wibSlot(runAt).key }, ctx)), runAt: runAt.toISOString() });
    if (action === "draft") {
      const d = await draftFor(ctx, a, String(body?.supplier || ""), runAt);
      if (!d) return NextResponse.json({ error: "That e-mail is not in this run." }, { status: 404 });
      const eml = buildEml({ to: d.plan.to, cc: d.plan.cc, subject: d.plan.subject, body: d.plan.body || "", attachments: d.attachments, html: toHtml(d.plan.body || "", ctx.cfg.font) });
      if (Buffer.byteLength(eml) > 4_000_000) return NextResponse.json({ error: "This draft is larger than 4 MB to download. The automation itself can still send it (limit 10 MB)." }, { status: 413 });
      return NextResponse.json({ fileName: emlFileName(d.plan.supplier), eml: Buffer.from(eml, "utf8").toString("base64"), attachments: d.attachments.map((x) => ({ name: x.name, size: Math.floor(x.contentBytes.length * 3 / 4) })) });
    }
    if (action === "notice-test") {
      const preview = await runAutomation(supabase, a, { now: runAt, dryRun: true, actorId: auth.userId, slot: wibSlot(runAt).key }, ctx);
      const n = await sendNotice(a, preview, runAt);
      await supabase.from("audit_events").insert({ actor_id: auth.userId, action: "IMDS_FOLLOWUP_SCHEDULE_NOTICE", entity_type: "imds_tracker_schedule", metadata: { automation: a.id, name: a.name, test: true, to: n.to, ok: n.ok, error: n.error || null } });
      return NextResponse.json(n, { status: n.ok ? 200 : 502 });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
