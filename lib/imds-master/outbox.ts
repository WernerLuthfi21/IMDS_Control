import type { SupabaseClient } from "@supabase/supabase-js";
import { postToFlow } from "@/lib/automation/flow";

type MasterRecord = Record<string, unknown>;

const BATCH_SIZE = 25;
const MAX_ATTEMPTS = 5;

function value(row: MasterRecord, key: string): string {
  const current = row[key];
  return current === null || current === undefined ? "" : String(current);
}

export function toPartMasterExcelRow(row: MasterRecord) {
  const md = Array.isArray(row.md_system_records)
    ? (row.md_system_records as MasterRecord[])[0] || {}
    : {};
  const sourceRow = Number(row.source_row || 0);
  return {
    "No.": sourceRow > 6 ? sourceRow - 6 : "",
    PROJECT: value(row, "project"),
    "VENDOR CODE": value(row, "vendor_code"),
    "MAIN PIC EMAIL": value(row, "main_pic_email"),
    "COMPANY NAME": value(row, "company_name"),
    "PART NAME": value(row, "part_name"),
    "P/No.": value(row, "part_no"),
    "SUBMISSION PLAN": value(row, "submission_plan"),
    "IMDS STATUS": value(row, "imds_status"),
    "ID / Ver": value(row, "imds_id_version"),
    "Part Status": value(row, "part_status"),
    "Have respond email": value(row, "have_respond_email"),
    "STATUS UPDATE": value(row, "status_update") || value(md, "status"),
    "ID/Ver": value(row, "md_id_version") || value(md, "idVersion"),
    Date: value(row, "md_status_update_date") || value(md, "lastStatusChanged"),
    Comment: value(row, "comment") || value(md, "reasonForDenial"),
    "LPOP Confirmation": value(row, "lpop_confirmation"),
    CEK: value(row, "cek"),
    MasterKey: value(row, "master_key"),
    "Supplier Promise Date": value(row, "supplier_promise_date"),
  };
}

/** Add durable batches before calling Power Automate. Failed or unconfigured deliveries remain visible and retryable. */
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
  if (!url || !/^https:\/\//i.test(url)) {
    return { configured: false, sent: 0, failed: 0, pending: pendingCount || 0, error: "POWER_AUTOMATE_TRACKER_URL is not configured." };
  }

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

    const result = await postToFlow(url, secret, job.payload);
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
