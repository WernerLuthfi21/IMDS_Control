import { cleanCell } from "@/lib/imds-master/clean-cell";
import type { SupabaseClient } from "@supabase/supabase-js";
import { postToFlow } from "@/lib/automation/flow";
import { mapMdStatusToImds } from "./md-current";

type MasterRecord = Record<string, unknown>;

/** Rows per request to the Tracker flow. 25 suits a per-row loop; with the UpsertRows Office Script set
 * POWER_AUTOMATE_TRACKER_BATCH=200 (one Excel call per request, far fewer runs). Capped at 500. */
const BATCH_SIZE = Math.min(500, Math.max(1, Number(process.env.POWER_AUTOMATE_TRACKER_BATCH) || 25));
const MAX_ATTEMPTS = 5;

function value(row: MasterRecord, key: string): string {
  return cleanCell(row[key]);
}

function printable(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(printable).filter(Boolean).join("; ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function toPartMasterExcelRow(row: MasterRecord) {
  const md = Array.isArray(row.md_system_records)
    ? (row.md_system_records as MasterRecord[])[0] || {}
    : {};
  const extra = (row.extra_fields && typeof row.extra_fields === "object" ? row.extra_fields : {}) as MasterRecord;
  const noValue = extra["No. [col 1]"] ?? extra["No."] ?? "";
  // One clean, ALL-CAPS sheet: a single status, a single ID/version, two dates. KEY is the hidden row identity.
  const output: Record<string, unknown> = {
    "NO.": printable(noValue) || (Number(row.source_row || 0) > 6 ? Number(row.source_row) - 6 : ""),
    PROJECT: value(row, "project"),
    "VENDOR CODE": value(row, "vendor_code"),
    "MAIN PIC EMAIL": value(row, "main_pic_email"),
    "COMPANY NAME": value(row, "company_name"),
    "PART NAME": value(row, "part_name"),
    "PART NO.": value(row, "part_no"),
    "SUBMISSION PLAN": value(row, "submission_plan"),
    "PART STATUS": value(row, "imds_status") || (mapMdStatusToImds(value(md, "status")) ?? ""),
    "ID / VER": value(row, "imds_id_version") || value(row, "md_id_version") || value(md, "idVersion"),
    "STATUS DATE": value(row, "md_status_update_date") || value(md, "lastStatusChanged"),
    COMMENT: value(row, "comment") || value(md, "reasonForDenial"),
    KEY: value(row, "master_key"),
  };
  return output;
}

const LEGACY_HEADERS: Array<[string, string]> = [["MasterKey", "KEY"], ["master_key", "KEY"], ["P/No.", "PART NO."], ["ID / Ver", "ID / VER"], ["Date", "STATUS DATE"], ["Comment", "COMMENT"], ["No.", "NO."]];

/**
 * Batches queued BEFORE the sheet was simplified still carry the old header names (MasterKey, P/No., ...).
 * Convert them to the current 13-column shape and drop rows that have no key, so the flow never receives a row it cannot match.
 */
export function normalizeQueuedPayload(payload: unknown): { payload: Record<string, unknown>; dropped: number } {
  const base = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const rows = Array.isArray(base.rows) ? (base.rows as Record<string, unknown>[]) : [];
  const out: Record<string, unknown>[] = [];
  let dropped = 0;
  for (const row of rows) {
    const r: Record<string, unknown> = { ...row };
    for (const [from, to] of LEGACY_HEADERS) if (from in r && !(to in r)) r[to] = r[from];
    if (!("PART STATUS" in r) && "IMDS STATUS" in r) r["PART STATUS"] = r["IMDS STATUS"];
    const clean: Record<string, unknown> = {};
    for (const h of ["NO.", "PROJECT", "VENDOR CODE", "MAIN PIC EMAIL", "COMPANY NAME", "PART NAME", "PART NO.", "SUBMISSION PLAN", "PART STATUS", "ID / VER", "STATUS DATE", "COMMENT", "KEY"]) clean[h] = r[h] ?? "";
    if (String(clean.KEY).trim()) out.push(clean); else dropped++;
  }
  return { payload: { ...base, rows: out }, dropped };
}

/** Add durable batches before calling Power Automate. Failed or unconfigured deliveries remain retryable. */
export async function enqueuePartMasterRows(
  supabase: SupabaseClient,
  actorId: string,
  rows: MasterRecord[],
  source: string
): Promise<{ queued: number; rows: number }> {
  if (!rows.length) return { queued: 0, rows: 0 };
  let queued = 0;
  for (let index = 0; index < rows.length; index += BATCH_SIZE) {
    const batch = rows.slice(index, index + BATCH_SIZE);
    const { error } = await supabase.from("imds_tracker_outbox").insert({
      payload: {
        type: "imds_tracker_bulk_upsert",
        source,
        rows: batch.map(toPartMasterExcelRow),
      },
      row_count: batch.length,
      status: "PENDING",
      created_by: actorId,
    });
    if (error) throw new Error(`Could not queue master Excel update: ${error.message}`);
    queued++;
  }
  return { queued, rows: rows.length };
}

export async function dispatchPartMasterOutbox(
  supabase: SupabaseClient,
  limit = 20
): Promise<{ configured: boolean; sent: number; failed: number; pending: number; error?: string }> {
  const url = process.env.POWER_AUTOMATE_TRACKER_URL?.trim();
  const secret = process.env.POWER_AUTOMATE_SECRET?.trim() || null;
  const { count: pendingCount, error: countError } = await supabase
    .from("imds_tracker_outbox")
    .select("id", { count: "exact", head: true })
    .in("status", ["PENDING", "FAILED"])
    .lt("attempts", MAX_ATTEMPTS);
  if (countError) throw new Error(`Could not read master sync queue: ${countError.message}`);
  if (!url || !/^https:\/\//i.test(url) || !secret) {
    return { configured: false, sent: 0, failed: 0, pending: pendingCount || 0, error: "POWER_AUTOMATE_TRACKER_URL and POWER_AUTOMATE_SECRET must both be configured." };
  }

  // Release interrupted claims from requests that did not finish.
  await supabase.from("imds_tracker_outbox")
    .update({ status: "FAILED", last_error: "Previous send was interrupted; retrying." })
    .eq("status", "SENDING")
    .lt("updated_at", new Date(Date.now() - 120000).toISOString());

  const { data: jobs, error: jobsError } = await supabase
    .from("imds_tracker_outbox")
    .select("id,payload,attempts")
    .in("status", ["PENDING", "FAILED"])
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(Math.max(1, Math.min(50, limit)));
  if (jobsError) throw new Error(`Could not load master sync queue: ${jobsError.message}`);

  let sent = 0;
  let failed = 0;
  for (const job of jobs || []) {
    const nextAttempt = Number(job.attempts || 0) + 1;
    const { data: claimed, error: claimError } = await supabase
      .from("imds_tracker_outbox")
      .update({ status: "SENDING", attempts: nextAttempt, last_error: null })
      .eq("id", job.id)
      .in("status", ["PENDING", "FAILED"])
      .select("id");
    if (claimError) throw new Error(`Could not claim master sync item: ${claimError.message}`);
    if (!claimed?.length) continue;

    const normalized = normalizeQueuedPayload(job.payload);
    const result = (normalized.payload.rows as unknown[]).length
      ? await postToFlow(url, secret, normalized.payload)
      : { ok: false, status: 0, error: "This queued batch has no rows with a KEY (old format). Nothing was sent; run Sync to Excel now to queue fresh data." };
    const { error: updateError } = await supabase
      .from("imds_tracker_outbox")
      .update({
        status: result.ok ? "SENT" : "FAILED",
        sent_at: result.ok ? new Date().toISOString() : null,
        last_error: result.ok ? null : result.error || `Power Automate HTTP ${result.status}`,
        provider_response: { ok: result.ok, status: result.status },
      })
      .eq("id", job.id);
    if (updateError) throw new Error(`Power Automate returned but queue status could not be saved: ${updateError.message}`);
    if (result.ok) sent++;
    else failed++;
  }

  const { count: remaining, error: remainingError } = await supabase
    .from("imds_tracker_outbox")
    .select("id", { count: "exact", head: true })
    .in("status", ["PENDING", "FAILED", "SENDING"])
    .lt("attempts", MAX_ATTEMPTS);
  if (remainingError) throw new Error(`Could not verify remaining master sync queue: ${remainingError.message}`);
  return { configured: true, sent, failed, pending: remaining || 0 };
}
