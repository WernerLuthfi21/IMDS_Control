import { after, NextRequest, NextResponse } from "next/server";
import { UUID, validIds } from "@/lib/judgement/ids";
import { getAuthContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { enqueue, dispatch } from "@/lib/automation/outbox";
import { evaluateBulkCandidate, loadBulkContext, type BulkSourceItem } from "@/lib/judgement/bulk";
import { loadPartMemory, partKey } from "@/lib/judgement/memory";
import { loadEscalations } from "@/lib/judgement/escalation";
import { AUTO_KINDS, DEFAULT_AUTOJUDGE, RULESET, RULESET_LABEL, SYSTEM_ACTOR, decideAuto, sanitizeAutoJudge, type AutoJudgeConfig } from "@/lib/judgement/autojudge";

export const runtime = "nodejs";
export const maxDuration = 60;

type Db = NonNullable<Awaited<ReturnType<typeof createClient>>>;
const RUN_ROLES = ["admin", "preparer", "reviewer"];
const CONFIG_ROLES = ["admin", "rule_approver"];
const TABLE_MISSING = /imds_tracker_settings|relation .* does not exist|schema cache|violates check constraint/i;
const MIGRATION_HINT = "Run supabase/migrations/20261110000000_tracker_settings.sql and 20261118000000_judgement_memory_autojudge.sql in the Supabase SQL editor.";
const BATCH = 10;

type Row = BulkSourceItem & { assigned_person: string | null; starting_date: string | null; judgement_procedure: string | null; ok_comment: string | null; imds_reject_comment: string | null; last_change_date: string | null };

async function loadConfig(supabase: Db): Promise<{ config: AutoJudgeConfig; version: number; missing: boolean }> {
  const { data, error } = await supabase.from("imds_tracker_settings").select("value,version").eq("key", "autojudge_config").maybeSingle();
  if (error) return { config: DEFAULT_AUTOJUDGE, version: 0, missing: TABLE_MISSING.test(error.message) };
  return { config: sanitizeAutoJudge(data?.value ?? DEFAULT_AUTOJUDGE), version: data?.version ?? 0, missing: false };
}
async function loadRows(supabase: Db, ids: string[]): Promise<Row[]> {
  const { data, error } = await supabase.from("gcat_error_items")
    .select("id,source_record_key,error_type_label,delivery_part_no,supplier_code,source_status,judge,raw_source,assigned_person,starting_date,judgement_procedure,ok_comment,imds_reject_comment,last_change_date")
    .in("id", ids);
  if (error) throw new Error(error.message);
  return (data || []) as unknown as Row[];
}
async function inBatches<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += BATCH) out.push(...await Promise.all(items.slice(i, i + BATCH).map(fn)));
  return out;
}
const jakartaDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());

export async function GET() {
  const auth = await getAuthContext();
  if (!auth.configured) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  if (!auth.userId || !auth.role || auth.role === "supplier") return NextResponse.json({ error: "Internal sign-in is required." }, { status: 401 });
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const { config, version, missing } = await loadConfig(supabase);
  return NextResponse.json({ config, version, missing, migrationHint: missing ? MIGRATION_HINT : null, kinds: AUTO_KINDS,
    canRun: RUN_ROLES.includes(auth.role), canConfigure: CONFIG_ROLES.includes(auth.role), systemActor: SYSTEM_ACTOR, ruleSet: RULESET, ruleSetLabel: RULESET_LABEL }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: NextRequest) {
  const auth = await getAuthContext();
  if (!auth.configured) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  if (!auth.userId || !CONFIG_ROLES.includes(auth.role || "")) return NextResponse.json({ error: "Only an admin or rule approver can change auto-judgement." }, { status: 403 });
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const body = await request.json().catch(() => null) as { config?: unknown; baseVersion?: number } | null;
  const next = sanitizeAutoJudge(body?.config);
  const current = await loadConfig(supabase);
  if (current.missing) return NextResponse.json({ error: "The settings table is missing. " + MIGRATION_HINT }, { status: 503 });
  if (typeof body?.baseVersion === "number" && body.baseVersion !== current.version) return NextResponse.json({ error: "Someone else changed these settings. Reload and try again.", conflict: true }, { status: 409 });
  const turnedOn = next.enabled && !next.shadow && AUTO_KINDS.some((k) => next.kinds[k] && !(current.config.enabled && !current.config.shadow && current.config.kinds[k]));
  // Saving the panel is the approval for the current rule set.
  next.ruleSet = RULESET;
  const ruleSetChanged = current.config.ruleSet !== RULESET && next.enabled && AUTO_KINDS.some((k) => next.kinds[k]);
  if (turnedOn || ruleSetChanged || (next.enabled && !current.config.enabled)) { next.approvedBy = auth.displayName || auth.email || auth.userId; next.approvedAt = new Date().toISOString(); }
  else { next.approvedBy = current.config.approvedBy; next.approvedAt = current.config.approvedAt; }
  const version = current.version + 1;
  const { error } = current.version
    ? await supabase.from("imds_tracker_settings").update({ value: next, version, updated_by: auth.userId, updated_at: new Date().toISOString() }).eq("key", "autojudge_config").eq("version", current.version)
    : await supabase.from("imds_tracker_settings").insert({ key: "autojudge_config", value: next, version: 1, updated_by: auth.userId });
  if (error) return NextResponse.json({ error: TABLE_MISSING.test(error.message) ? "Auto-judgement settings cannot be saved yet. " + MIGRATION_HINT : error.message }, { status: TABLE_MISSING.test(error.message) ? 503 : 500 });
  await supabase.from("audit_events").insert({ actor_id: auth.userId, action: "AUTOJUDGE_CONFIG_CHANGED", entity_type: "autojudge_config", metadata: { before: current.config, after: next } });
  return NextResponse.json({ config: next, version: current.version ? version : 1 });
}

export async function POST(request: NextRequest) {
  const auth = await getAuthContext();
  if (!auth.configured) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  if (!auth.userId || !RUN_ROLES.includes(auth.role || "")) return NextResponse.json({ error: "Preparer, reviewer or admin role is required." }, { status: 403 });
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = body?.action;

  if (action === "reopen") {
    const id = typeof body?.id === "string" && UUID.test(body.id) ? body.id : "";
    const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    if (!id || reason.length < 3) return NextResponse.json({ error: "Give a short reason to reopen this automatic decision." }, { status: 400 });
    const [row] = await loadRows(supabase, [id]);
    if (!row) return NextResponse.json({ error: "Case not found." }, { status: 404 });
    if (row.assigned_person !== SYSTEM_ACTOR || !row.judge) return NextResponse.json({ error: "Only an automatic decision can be reopened here." }, { status: 409 });
    const restore = {
      judge: null, judge_status: null, ok_comment: null, imds_reject_comment: null, assigned_person: null, last_change_date: new Date().toISOString(),
      judge_override: true, ok_comment_override: true, imds_reject_comment_override: true, assigned_person_override: true, last_change_date_override: true
    };
    const { data, error } = await supabase.from("gcat_error_items").update(restore).eq("id", id).eq("assigned_person", SYSTEM_ACTOR).select("id").maybeSingle();
    if (error || !data) return NextResponse.json({ error: error?.message || "The case changed; nothing was reopened." }, { status: 409 });
    await supabase.from("register_change_log").insert({ item_id: id, actor_id: auth.userId, changed_columns: Object.keys(restore), before_values: { judge: row.judge, assigned_person: row.assigned_person, ok_comment: row.ok_comment, imds_reject_comment: row.imds_reject_comment }, after_values: restore });
    await supabase.from("audit_events").insert({ actor_id: auth.userId, action: "JUDGEMENT_AUTO_REOPENED", entity_type: "gcat_error_item", entity_id: id, metadata: { reason, previousJudge: row.judge } });
    await enqueue(supabase, auth.userId, { kind: "EXCEL_UPSERT", itemId: id });
    after(async () => { try { await dispatch(supabase, { kind: "EXCEL_UPSERT", limit: 50 }); } catch { /* retried later */ } });
    return NextResponse.json({ reopened: true });
  }

  if (action !== "run" && action !== "compare") return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
  const ids = validIds(body?.ids);
  if (!ids) return NextResponse.json({ error: "Send 1–250 case ids per request." }, { status: 400 });
  const { config } = await loadConfig(supabase);
  let rows: Row[];
  try { rows = await loadRows(supabase, ids); } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Could not read the cases." }, { status: 500 }); }
  const memory = (await loadPartMemory(supabase, rows.map((r) => r.delivery_part_no || ""))).map;
  const [escalations, ctx] = await Promise.all([loadEscalations(supabase, rows.map((r) => r.delivery_part_no || "")).then((r) => r.map), loadBulkContext(supabase, rows)]);

  if (action === "compare") {
    // Shadow report: what the engine would decide on cases people already judged.
    const results = await inBatches(rows.filter((r) => r.judge && r.assigned_person !== SYSTEM_ACTOR), async (row) => {
      const c = await evaluateBulkCandidate(supabase, { ...row, judge: null, source_status: "WORKING" }, memory.get(partKey(row.delivery_part_no)), escalations, ctx);
      const decided = c.eligible && (c.recommendation.state === "OK" || c.recommendation.state === "NG");
      return { id: row.id, kind: c.kind, human: row.judge, engine: decided ? c.recommendation.state : null, agree: decided ? c.recommendation.state === row.judge : null };
    });
    return NextResponse.json({ results });
  }

  const timestamp = new Date().toISOString();
  const results = await inBatches(rows, async (row) => {
    const c = await evaluateBulkCandidate(supabase, row, memory.get(partKey(row.delivery_part_no)), escalations, ctx);
    const d = decideAuto(c, config);
    if (d.action !== "FINAL") return { id: row.id, kind: c.kind, action: d.action, decision: "decision" in d ? d.decision : null, reason: d.reason };
    const before = { assigned_person: row.assigned_person, starting_date: row.starting_date, judgement_procedure: row.judgement_procedure, judge: row.judge, ok_comment: row.ok_comment, imds_reject_comment: row.imds_reject_comment };
    const patch = {
      assigned_person: SYSTEM_ACTOR, starting_date: row.starting_date || jakartaDate(),
      judgement_procedure: c.procedureText || row.judgement_procedure, judge: d.decision,
      ok_comment: d.decision === "OK" ? c.recommendation.comment : null, imds_reject_comment: d.decision === "NG" ? c.recommendation.comment : null,
      judge_status: d.decision, last_change_date: timestamp,
      assigned_person_override: true, starting_date_override: true, judgement_procedure_override: true, judge_override: true,
      ok_comment_override: true, imds_reject_comment_override: true, last_change_date_override: true
    };
    const { data, error } = await supabase.from("gcat_error_items").update(patch).eq("id", row.id).is("judge", null).select("id").maybeSingle();
    if (error || !data) return { id: row.id, kind: c.kind, action: "SKIP" as const, decision: null, reason: error?.message || "Already judged by someone else." };
    await supabase.from("register_change_log").insert({ item_id: row.id, actor_id: auth.userId, changed_columns: Object.keys(patch), before_values: before, after_values: patch });
    await supabase.from("audit_events").insert({ actor_id: auth.userId, action: "JUDGEMENT_AUTO_FINAL", entity_type: "gcat_error_item", entity_id: row.id,
      metadata: { decision: d.decision, kind: c.kind, reason: c.recommendation.reason, signature: c.signature, triggeredBy: auth.displayName || auth.email, config: { kinds: config.kinds, approvedBy: config.approvedBy, approvedAt: config.approvedAt } } });
    await enqueue(supabase, auth.userId!, { kind: "EXCEL_UPSERT", itemId: row.id });
    return { id: row.id, kind: c.kind, action: "FINAL" as const, decision: d.decision, reason: c.recommendation.reason };
  });
  if (results.some((r) => r.action === "FINAL")) after(async () => { try { await dispatch(supabase, { kind: "EXCEL_UPSERT", limit: 250 }); } catch { /* retried later */ } });
  return NextResponse.json({ results, config: { enabled: config.enabled, shadow: config.shadow } });
}
