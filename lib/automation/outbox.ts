import type { SupabaseClient } from "@supabase/supabase-js";
import { buildExcelPayload, flowConfig, postToFlow, type RegisterRow } from "./flow";

const ROW_COLUMNS = "source_record_key,error_type_label,delivery_part_no,supplier_code,assigned_person,starting_date,judgement_procedure,judge,ok_comment,imds_reject_comment,km_judge,km_comment,last_change_date";
const MAX_ATTEMPTS = 5;

export async function enqueue(supabase: SupabaseClient, actorId: string, job: { kind: "EXCEL_UPSERT"; itemId: string } | { kind: "SUPPLIER_EMAIL"; followupId: string; itemId?: string | null }) {
  const row = { kind: job.kind, item_id: job.itemId ?? null, followup_id: "followupId" in job ? job.followupId : null, created_by: actorId };
  const { data } = await supabase.from("sync_outbox").insert(row).select("id").single();
  return data?.id as string | undefined;
}

type Job = { id: string; kind: "EXCEL_UPSERT" | "SUPPLIER_EMAIL"; item_id: string | null; followup_id: string | null; attempts: number };

/** Send queued jobs strictly one after another. Safe to call concurrently: each job is claimed first. */
export async function dispatch(supabase: SupabaseClient, opts: { limit?: number; kind?: Job["kind"]; followupId?: string; fetchImpl?: typeof fetch } = {}) {
  const cfg = flowConfig();
  const summary = { sent: 0, failed: 0, skipped: 0, configured: { excel: !!cfg.excelUrl, email: !!cfg.emailUrl } };
  // A crashed run can leave rows in SENDING; release them after two minutes so they are retried.
  await supabase.from("sync_outbox").update({ status: "FAILED", last_error: "interrupted" }).eq("status", "SENDING").lt("updated_at", new Date(Date.now() - 120000).toISOString());
  let q = supabase.from("sync_outbox").select("id,kind,item_id,followup_id,attempts").in("status", ["PENDING", "FAILED"]).lt("attempts", MAX_ATTEMPTS).order("created_at", { ascending: true }).limit(opts.limit ?? 25);
  if (opts.kind) q = q.eq("kind", opts.kind);
  if (opts.followupId) q = q.eq("followup_id", opts.followupId);
  const { data: jobs } = await q;
  const done = new Set<string>(); // coalesce: several saves of one item need only the newest state
  for (const job of (jobs || []) as Job[]) {
    const url = job.kind === "EXCEL_UPSERT" ? cfg.excelUrl : cfg.emailUrl;
    if (!url) { summary.skipped++; continue; }
    const { data: claimed } = await supabase.from("sync_outbox").update({ status: "SENDING", attempts: job.attempts + 1 }).eq("id", job.id).in("status", ["PENDING", "FAILED"]).select("id");
    if (!claimed?.length) continue;
    let result: { ok: boolean; error?: string };
    if (job.kind === "EXCEL_UPSERT") {
      if (job.item_id && done.has(job.item_id)) { await supabase.from("sync_outbox").update({ status: "SENT", sent_at: new Date().toISOString(), last_error: "coalesced" }).eq("id", job.id); summary.sent++; continue; }
      const { data: row } = await supabase.from("gcat_error_items").select(ROW_COLUMNS).eq("id", job.item_id).maybeSingle();
      if (!row) result = { ok: false, error: "Register row not found" };
      else { result = await postToFlow(url, cfg.secret, { type: "excel_upsert", ...buildExcelPayload(row as unknown as RegisterRow) }, opts.fetchImpl); if (result.ok && job.item_id) done.add(job.item_id); }
    } else {
      const { data: f } = await supabase.from("supplier_followups").select("id,supplier_code,recipient_email,cc_emails,subject,message_body,status").eq("id", job.followup_id).maybeSingle();
      if (!f) result = { ok: false, error: "Follow-up not found" };
      else if (f.status === "SENT" || f.status === "CANCELLED") { await supabase.from("sync_outbox").update({ status: "SENT", last_error: "already " + f.status }).eq("id", job.id); continue; }
      else {
        result = await postToFlow(url, cfg.secret, { type: "supplier_email", followupId: f.id, to: f.recipient_email, cc: (f.cc_emails || []).join(";"), subject: f.subject, body: f.message_body }, opts.fetchImpl);
        // "SENT" means the flow accepted the request (HTTP 2xx), not that the supplier read it.
        if (result.ok) await supabase.from("supplier_followups").update({ status: "SENT", sent_at: new Date().toISOString() }).eq("id", f.id);
      }
    }
    if (result.ok) { await supabase.from("sync_outbox").update({ status: "SENT", sent_at: new Date().toISOString(), last_error: null }).eq("id", job.id); summary.sent++; }
    else { await supabase.from("sync_outbox").update({ status: "FAILED", last_error: result.error ?? "failed" }).eq("id", job.id); summary.failed++; }
  }
  return summary;
}
