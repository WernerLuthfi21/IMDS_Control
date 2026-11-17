import { after } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { enqueue, dispatch } from "@/lib/automation/outbox";
import { evaluateBulkCandidate, groupBulkCandidates, type BulkSourceItem } from "@/lib/judgement/bulk";
import { loadPartMemory, partKey } from "@/lib/judgement/memory";

export const runtime = "nodejs";
export const maxDuration = 60;
const EDIT_ROLES = ["admin", "preparer", "reviewer"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 10;
function validIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 250) return null;
  if (value.some((id) => typeof id !== "string" || !UUID.test(id))) return null;
  const ids = [...new Set(value as string[])];
  return ids.length === value.length ? ids : null;
}
async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...await Promise.all(items.slice(i, i + size).map(fn)));
  return out;
}
function jakartaDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
}
async function loadRows(supabase: NonNullable<Awaited<ReturnType<typeof createClient>>>, ids: string[]) {
  const { data, error } = await supabase.from("gcat_error_items")
    .select("id,source_record_key,error_type_label,delivery_part_no,supplier_code,source_status,judge,raw_source,assigned_person,starting_date,judgement_procedure,ok_comment,imds_reject_comment,last_change_date")
    .in("id", ids);
  if (error) throw new Error(error.message);
  return (data || []) as unknown as Array<BulkSourceItem & {
    assigned_person: string | null; starting_date: string | null; judgement_procedure: string | null;
    ok_comment: string | null; imds_reject_comment: string | null; last_change_date: string | null;
  }>;
}
async function logChange(supabase: NonNullable<Awaited<ReturnType<typeof createClient>>>, actorId: string, itemId: string, before: Record<string, unknown>, afterValues: Record<string, unknown>, action: string) {
  await supabase.from("register_change_log").insert({
    item_id: itemId, actor_id: actorId, changed_columns: Object.keys(afterValues),
    before_values: before, after_values: afterValues
  });
  await supabase.from("audit_events").insert({
    actor_id: actorId, action, entity_type: "gcat_error_item", entity_id: itemId,
    metadata: { changedColumns: Object.keys(afterValues), source: "bulk-judgement" }
  });
}
export async function POST(request: NextRequest) {
  const auth = await getAuthContext();
  if (!auth.configured) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  if (!auth.userId || !auth.role || auth.role === "supplier") return NextResponse.json({ error: "Internal sign-in is required." }, { status: 401 });
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Database connection is unavailable." }, { status: 503 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") return NextResponse.json({ error: "Action is required." }, { status: 400 });

  if (body.action === "preview") {
    const ids = validIds(body.ids);
    if (!ids) return NextResponse.json({ error: "Choose 1–250 unique register records for analysis." }, { status: 400 });
    try {
      const rows = await loadRows(supabase, ids);
      const memory = (await loadPartMemory(supabase, rows.map((row) => row.delivery_part_no || ""))).map;
      const candidates = await inBatches(rows, PAGE_SIZE, (row) => evaluateBulkCandidate(supabase, row, memory.get(partKey(row.delivery_part_no))));
      const prohibited = candidates.filter((item) => item.prohibited);
      return NextResponse.json({
        evaluated: candidates.length, notFound: ids.length - rows.length,
        groups: groupBulkCandidates(candidates), candidates,
        coverage: {
          total: prohibited.length,
          connected: prohibited.filter((item) => item.prohibitedStatus === "CONNECTED").length,
          needsReview: prohibited.filter((item) => item.prohibitedStatus !== "CONNECTED").length,
          missingCas: prohibited.filter((item) => !item.cas.trim()).length
        }
      }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Bulk preview failed." }, { status: 422 });
    }
  }

  if (body.action === "apply") {
    if (!EDIT_ROLES.includes(auth.role)) return NextResponse.json({ error: "Preparer, reviewer or admin role is required." }, { status: 403 });
    const ids = validIds(body.ids);
    const signature = typeof body.signature === "string" ? body.signature : "";
    const decision = body.decision;
    if (!ids || !/^[a-f0-9]{64}$/.test(signature) || (decision !== "OK" && decision !== "NG")) {
      return NextResponse.json({ error: "Invalid bulk judgement request." }, { status: 400 });
    }
    try {
      const rows = await loadRows(supabase, ids);
      if (rows.length !== ids.length) return NextResponse.json({ error: "One or more cases are no longer available. Re-run the preview." }, { status: 409 });
      const memory = (await loadPartMemory(supabase, rows.map((row) => row.delivery_part_no || ""))).map;
      const candidates = await inBatches(rows, PAGE_SIZE, (row) => evaluateBulkCandidate(supabase, row, memory.get(partKey(row.delivery_part_no))));
      const consistent = candidates.length === ids.length
        && candidates.every((item) => item.signature === signature && item.eligible && item.inPendingQueue && item.recommendation.state === decision);
      if (!consistent) return NextResponse.json({ error: "The case data or recommendation changed after preview. Nothing was applied; run the preview again." }, { status: 409 });
      const byId = new Map(rows.map((row) => [row.id, row]));
      const timestamp = new Date().toISOString();
      const actorName = auth.displayName || auth.email || "IMDS user";
      const results = await inBatches(candidates, PAGE_SIZE, async (candidate) => {
        const row = byId.get(candidate.id)!;
        const before = {
          assigned_person: row.assigned_person, starting_date: row.starting_date,
          judgement_procedure: row.judgement_procedure, judge: row.judge,
          ok_comment: row.ok_comment, imds_reject_comment: row.imds_reject_comment
        };
        const patch = {
          assigned_person: before.assigned_person || actorName,
          starting_date: before.starting_date || jakartaDate(),
          judgement_procedure: candidate.procedureText || before.judgement_procedure,
          judge: decision,
          ok_comment: decision === "OK" ? candidate.recommendation.comment : null,
          imds_reject_comment: decision === "NG" ? candidate.recommendation.comment : null,
          judge_status: decision, last_change_date: timestamp,
          assigned_person_override: true, starting_date_override: true,
          judgement_procedure_override: true, judge_override: true,
          ok_comment_override: true, imds_reject_comment_override: true, last_change_date_override: true
        };
        const { data, error } = await supabase.from("gcat_error_items").update(patch)
          .eq("id", candidate.id).is("judge", null).select("id,last_change_date").maybeSingle();
        if (error || !data) return { id: candidate.id, ok: false, error: error?.message || "Already judged or changed by another user.", undo: undefined };
        await logChange(supabase, auth.userId!, candidate.id, before, { ...patch }, "JUDGEMENT_BULK_APPLIED");
        await enqueue(supabase, auth.userId!, { kind: "EXCEL_UPSERT", itemId: candidate.id });
        return { id: candidate.id, ok: true, error: undefined, undo: {
          id: candidate.id, decision, lastChangeDate: data.last_change_date, before
        } };
      });
      const succeeded = results.filter((item) => item.ok);
      const failed = results.filter((item) => !item.ok);
      await supabase.from("audit_events").insert({
        actor_id: auth.userId, action: "JUDGEMENT_BULK_BATCH_APPLIED", entity_type: "judgement_bulk_batch",
        metadata: { itemIds: succeeded.map((item) => item.id), decision, succeeded: succeeded.length, failed: failed.length }
      });
      after(async () => { try { await dispatch(supabase, { kind: "EXCEL_UPSERT", limit: 250 }); } catch { /* jobs remain retryable */ } });
      return NextResponse.json({
        succeeded: succeeded.length, failed: failed.length,
        results: results.map(({ id, ok, error }) => ({ id, ok, error })),
        undoItems: succeeded.flatMap((item) => item.undo ? [item.undo] : [])
      });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Bulk judgement failed." }, { status: 422 });
    }
  }

  if (body.action === "undo") {
    if (!EDIT_ROLES.includes(auth.role)) return NextResponse.json({ error: "Preparer, reviewer or admin role is required." }, { status: 403 });
    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 250) return NextResponse.json({ error: "Undo payload is invalid." }, { status: 400 });
    const requests = body.items as Array<Record<string, unknown>>;
    if (requests.some((item) => typeof item.id !== "string" || !UUID.test(item.id) || (item.decision !== "OK" && item.decision !== "NG") || typeof item.lastChangeDate !== "string" || !item.before || typeof item.before !== "object")) {
      return NextResponse.json({ error: "Undo snapshot is invalid." }, { status: 400 });
    }
    const results = await inBatches(requests, PAGE_SIZE, async (requestItem) => {
      const before = requestItem.before as Record<string, unknown>;
      if (before.judge !== null) return { id: requestItem.id, ok: false, error: "Only a newly applied pending-case judgement can be undone." };
      const safe = ["assigned_person", "starting_date", "judgement_procedure", "ok_comment", "imds_reject_comment"];
      if (safe.some((key) => before[key] !== null && typeof before[key] !== "string")) return { id: requestItem.id, ok: false, error: "Undo snapshot contains invalid values." };
      const restore = {
        assigned_person: before.assigned_person, starting_date: before.starting_date,
        judgement_procedure: before.judgement_procedure, judge: null,
        ok_comment: before.ok_comment, imds_reject_comment: before.imds_reject_comment,
        judge_status: null, last_change_date: new Date().toISOString(),
        assigned_person_override: true, starting_date_override: true,
        judgement_procedure_override: true, judge_override: true,
        ok_comment_override: true, imds_reject_comment_override: true, last_change_date_override: true
      };
      const { data, error } = await supabase.from("gcat_error_items").update(restore)
        .eq("id", requestItem.id as string).eq("judge", requestItem.decision as string)
        .eq("last_change_date", requestItem.lastChangeDate as string)
        .select("id,last_change_date").maybeSingle();
      if (error || !data) return { id: requestItem.id, ok: false, error: error?.message || "Record changed after the bulk action; undo was skipped." };
      await logChange(supabase, auth.userId!, requestItem.id as string,
        { judge: requestItem.decision, last_change_date: requestItem.lastChangeDate }, restore, "JUDGEMENT_BULK_UNDONE");
      await enqueue(supabase, auth.userId!, { kind: "EXCEL_UPSERT", itemId: requestItem.id as string });
      return { id: requestItem.id, ok: true, error: undefined };
    });
    after(async () => { try { await dispatch(supabase, { kind: "EXCEL_UPSERT", limit: 250 }); } catch { /* jobs remain retryable */ } });
    return NextResponse.json({ undone: results.filter((item) => item.ok).length, failed: results.filter((item) => !item.ok).length, results });
  }
  return NextResponse.json({ error: "Unsupported bulk judgement action." }, { status: 400 });
}
