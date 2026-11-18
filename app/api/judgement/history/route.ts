import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { UUID } from "@/lib/judgement/ids";
import { partKey as memoryPartKey } from "@/lib/judgement/memory";
import {
  NOT_RECORDED, buildTimeline, fromCaseFiles, fromChangeLog, fromCurrentState, fromEscalations, fromFollowups, fromMemory, fromRuns, fromSnapshots, isMissingTable,
  type ApprovalRow, type AuditRow, type ChangeRow, type EscalationRow, type EvidenceRow, type FollowupRow, type HistoryEvent, type HistoryResponse, type MemoryRow, type RunRow, type SourceState, type TaskRow
} from "@/lib/judgement/history";

export const runtime = "nodejs";
const INTERNAL = ["admin", "preparer", "reviewer", "viewer", "rule_author", "rule_approver"];
// Who can read which source under RLS (so an empty result can be reported as "restricted", not "nothing happened").
const CAN_READ_LOG = ["admin", "reviewer"];
const CAN_READ_AUDIT = ["admin", "reviewer", "rule_approver"];
const norm = (v: unknown) => String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const CAN_READ_SNAPSHOTS = ["admin", "reviewer", "preparer"]; // preparers: only batches they uploaded

/**
 * GET /api/judgement/history?itemId=<uuid> — the decision timeline of one register case.
 * Read-only, caller's own session (RLS applies), no new tables: import snapshots, the register change
 * log, audit events, rule runs and approvals, supplier follow-ups, remembered answers, TMC escalations,
 * evidence and verification tasks. Missing tables (migration not applied) are reported as "unavailable".
 */
export async function GET(request: NextRequest) {
  const auth = await getAuthContext();
  if (!auth.configured) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  if (!auth.userId || !auth.role || !INTERNAL.includes(auth.role)) return NextResponse.json({ error: "Internal sign-in is required." }, { status: 401 });
  const itemId = request.nextUrl.searchParams.get("itemId") || "";
  if (!UUID.test(itemId)) return NextResponse.json({ error: "A valid itemId is required." }, { status: 400 });
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Database connection is unavailable." }, { status: 503 });

  const { data: item, error: itemError } = await supabase.from("gcat_error_items")
    .select("id,case_id,source_record_key,error_type_label,delivery_part_no,supplier_code,judge,km_judge,source_judge_label,source_km_judge_label,last_change_date,starting_date,last_comment")
    .eq("id", itemId).maybeSingle();
  if (itemError) return NextResponse.json({ error: itemError.message }, { status: 500 });
  if (!item) return NextResponse.json({ error: "Case not found." }, { status: 404 });

  const role = auth.role;
  const sources: Record<string, SourceState> = {};
  const names = new Map<string, string>();
  if (auth.userId) names.set(auth.userId, auth.displayName || auth.email || "You");
  const name = (id: string | null) => (id ? names.get(id) ?? "A user" : null);
  /** Run one query; record the state of its source; never throw. */
  async function q<T>(key: string, run: () => PromiseLike<{ data: T[] | null; error: { code?: string; message?: string } | null }>, canRead = true): Promise<T[]> {
    try {
      const { data, error } = await run();
      if (error) { sources[key] = isMissingTable(error) ? "unavailable" : error.code === "42501" ? "restricted" : "error"; return []; }
      sources[key] = !canRead && !(data || []).length ? "restricted" : "ok";
      return data || [];
    } catch { sources[key] = "error"; return []; }
  }

  const caseId = item.case_id as string | null;
  const mem = memoryPartKey(item.delivery_part_no);
  const [batches, snapRows, log, audits, runs, followups, memory, escalations, evidence, tasks] = await Promise.all([
    q<{ id: string; file_name: string; committed_at: string | null }>("import_batches", () => supabase.from("import_batches").select("id,file_name,committed_at").eq("status", "COMMITTED").order("committed_at", { ascending: false }).limit(90), CAN_READ_SNAPSHOTS.includes(role)),
    q<{ batch_id: string; source_sheet: string; source_row: number; normalized: Record<string, unknown> | null; created_at: string }>("import_rows", () => supabase.from("import_rows").select("batch_id,source_sheet,source_row,normalized,created_at").eq("source_case_code", item.source_record_key).limit(200), CAN_READ_SNAPSHOTS.includes(role)),
    q<ChangeRow>("register_change_log", () => supabase.from("register_change_log").select("id,actor_id,changed_columns,before_values,after_values,created_at").eq("item_id", itemId).order("created_at").limit(200), CAN_READ_LOG.includes(role)),
    q<AuditRow>("audit_events", () => supabase.from("audit_events").select("id,actor_id,action,metadata,created_at").eq("entity_type", "gcat_error_item").eq("entity_id", itemId).order("created_at").limit(200), CAN_READ_AUDIT.includes(role)),
    caseId ? q<RunRow>("judgement_runs", () => supabase.from("judgement_runs").select("id,rule_id,rule_status,recommendation,reason,final_decision,created_at").eq("case_id", caseId).order("created_at").limit(50)) : Promise.resolve([] as RunRow[]),
    q<FollowupRow>("supplier_followups", () => supabase.from("supplier_followups").select("id,status,recipient_email,subject,created_at,composed_at,sent_at").eq("item_id", itemId).order("created_at").limit(50), ["admin", "reviewer", "preparer"].includes(role)),
    mem ? q<MemoryRow>("judgement_memory", () => supabase.from("judgement_memory").select("field,value,source,set_by_name,updated_at").eq("scope", "part").eq("scope_key", mem).limit(20)) : Promise.resolve([] as MemoryRow[]),
    // Escalations are shared by identical cases (same part + error type + CAS), so match the part too.
    q<EscalationRow & { item_id: string | null; error_type: string | null }>("judgement_escalations", () => supabase.from("judgement_escalations").select("id,item_id,error_type,history")
      .or(mem && !/[",()]/.test(mem) ? `item_id.eq.${itemId},part_no.eq."${mem}"` : `item_id.eq.${itemId}`).limit(20)),
    caseId ? q<EvidenceRow>("evidence", () => supabase.from("evidence").select("id,file_name,classification,created_at").eq("case_id", caseId).order("created_at").limit(50)) : Promise.resolve([] as EvidenceRow[]),
    caseId ? q<TaskRow>("verification_tasks", () => supabase.from("verification_tasks").select("id,title,status,created_at,completed_at").eq("case_id", caseId).order("created_at").limit(50)) : Promise.resolve([] as TaskRow[])
  ]);
  const approvals = runs.length ? await q<ApprovalRow>("approvals", () => supabase.from("approvals").select("id,judgement_run_id,reviewer_id,decision,comment,created_at").in("judgement_run_id", runs.map((r) => r.id)).limit(100)) : [];

  // Display names: profiles are readable for the caller's own row (and all rows for admins); others stay "A user".
  const actorIds = [...new Set([...log.map((r) => r.actor_id), ...audits.map((a) => a.actor_id), ...approvals.map((a) => a.reviewer_id)].filter((x): x is string => Boolean(x) && !names.has(x!)))];
  if (actorIds.length) {
    const { data } = await supabase.from("profiles").select("id,display_name").in("id", actorIds.slice(0, 100));
    for (const p of (data || []) as Array<{ id: string; display_name: string | null }>) if (p.display_name?.trim()) names.set(p.id, p.display_name.trim());
  }

  const batchById = new Map(batches.map((b) => [b.id, b]));
  const snaps = snapRows.filter((r) => batchById.has(r.batch_id)).map((r) => ({ ...r, file_name: batchById.get(r.batch_id)!.file_name, committed_at: batchById.get(r.batch_id)!.committed_at }));
  const seenIn = new Set(snaps.map((r) => r.batch_id));
  const logged: HistoryEvent[] = fromChangeLog(log, audits, name);
  const events = buildTimeline([
    fromSnapshots(snaps, sources.import_batches === "ok" && snaps.length ? batches.filter((b) => !seenIn.has(b.id)) : []),
    logged,
    fromRuns(runs, approvals, name),
    fromFollowups(followups),
    fromMemory(memory),
    fromEscalations(escalations.filter((e) => e.item_id === itemId || !e.error_type || norm(e.error_type) === norm(item.error_type_label))),
    fromCaseFiles(evidence, tasks),
    fromCurrentState(item, logged)
  ]);
  const body: HistoryResponse = {
    item: { id: item.id, partNo: item.delivery_part_no, supplierCode: item.supplier_code, errorType: item.error_type_label, sourceRecordKey: item.source_record_key },
    events, sources, notRecorded: NOT_RECORDED
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
