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
  if (!["admin","preparer","reviewer","viewer","rule_author","rule_approver"].includes(role)) redirect("/workspace");
  const year = new Date().getFullYear();
  const { data: batch } = await supabase.from("import_batches").select("id,file_name,source_sheet,created_at,committed_at")
    .eq("status","COMMITTED").order("committed_at",{ascending:false,nullsFirst:false}).limit(1).maybeSingle();
  let rows: Array<Record<string,unknown>> = [];
  let queryError: string | null = null;
  if (batch?.id) {
    const result = await supabase.from("gcat_error_items")
      .select("id,source_record_key,error_type_label,delivery_part_no,supplier_code,source_status,source_year,source_month,judge,km_judge,source_judge_label,source_km_judge_label,assigned_person,starting_date,judgement_procedure,ok_comment,imds_reject_comment,last_change_date,case_id")
      .eq("source_batch_id",batch.id).eq("source_year",String(year))
      .order("source_month",{ascending:false}).order("last_change_date",{ascending:false,nullsFirst:true}).range(0,4999);
    if(result.error) queryError=result.error.message; else rows=(result.data||[]) as Array<Record<string,unknown>>;
  }
  return <JudgementWorkspace rows={rows as never} year={year} role={role} sourceFile={batch?.file_name||null}
    sourceSheet={batch?.source_sheet||null} sourceDate={batch?.committed_at||batch?.created_at||null} queryError={queryError}/>;
}