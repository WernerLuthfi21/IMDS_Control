import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { JudgementWorkspace } from "@/components/judgement-workspace";

export const dynamic = "force-dynamic";

export default async function JudgementPage() {
  const supabase = await createClient();
  if (!supabase) redirect("/setup-required");
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login?next=%2Fjudgement");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  const role = profile?.role || "viewer";
  if (role === "supplier") redirect("/supplier-precheck");
  if (!["admin", "preparer", "reviewer", "viewer", "rule_author", "rule_approver"].includes(role)) redirect("/workspace");

  const year = new Date().getFullYear();

  // gcat_error_items is readable by all internal roles. import_batches metadata is
  // intentionally restricted by RLS, so derive the latest committed snapshot from
  // the most recently refreshed source record rather than widening batch permissions.
  const { data: latestSource, error: latestError } = await supabase.from("gcat_error_items")
    .select("source_batch_id,source_last_seen_at")
    .not("source_batch_id", "is", null)
    .order("source_last_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let rows: Array<Record<string, unknown>> = [];
  let queryError: string | null = latestError?.message || null;
  if (latestSource?.source_batch_id) {
    const result = await supabase.from("gcat_error_items")
      .select("id,source_record_key,error_type_label,delivery_part_no,supplier_code,source_status,source_year,source_month,judge,km_judge,source_judge_label,source_km_judge_label,assigned_person,starting_date,judgement_procedure,ok_comment,imds_reject_comment,last_change_date,case_id")
      .eq("source_batch_id", latestSource.source_batch_id)
      .eq("source_year", String(year))
      .order("source_month", { ascending: false })
      .order("last_change_date", { ascending: false, nullsFirst: true })
      .range(0, 4999);
    if (result.error) queryError = result.error.message;
    else rows = (result.data || []) as Array<Record<string, unknown>>;
  }

  return <JudgementWorkspace
    rows={rows as never}
    year={year}
    role={role}
    sourceFile="Latest committed G-CATS snapshot"
    sourceSheet="Current-year source records"
    sourceDate={latestSource?.source_last_seen_at || null}
    queryError={queryError}
  />;
}
