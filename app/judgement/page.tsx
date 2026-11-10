import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/lib/auth/session";
import { JudgementWorkspace } from "@/components/judgement-workspace";
import { extractRowFacts } from "@/lib/judgement/row-facts";

export const dynamic = "force-dynamic";

export default async function JudgementPage() {
  const auth = await getAuthContext();
  if (!auth.configured) redirect("/setup-required");
  if (!auth.userId) redirect("/login?next=%2Fjudgement");
  const role = auth.role || "viewer";
  if (role === "supplier") redirect("/supplier-precheck");
  if (!["admin", "preparer", "reviewer", "viewer", "rule_author", "rule_approver"].includes(role)) redirect("/workspace");
  const supabase = (await createClient())!;
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
    // Read every row in bounded pages. Never silently hide cases after a fixed 5,000-row window.
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const result = await supabase.from("gcat_error_items")
        .select("id,source_record_key,error_type_label,delivery_part_no,supplier_code,source_status,source_year,source_month,judge,km_judge,source_judge_label,source_km_judge_label,assigned_person,starting_date,judgement_procedure,ok_comment,imds_reject_comment,last_change_date,case_id,raw_source")
        .eq("source_batch_id", latestSource.source_batch_id)
        .eq("source_year", String(year))
        .order("source_month", { ascending: false })
        .order("last_change_date", { ascending: false, nullsFirst: true })
        .range(from, from + pageSize - 1);
      if (result.error) { queryError = result.error.message; break; }
      const batch = (result.data || []) as Array<Record<string, unknown>>;
      rows.push(...batch);
      if (batch.length < pageSize) break;
    }
    rows = rows.map(({ raw_source, ...rest }) => {
      // Only display fields go to the browser; source evidence stays on the server.
      const f = extractRowFacts(raw_source as Record<string, unknown> | null);
      return { ...rest, cas: f.cas, substance_name: f.substanceName };
    });
  }

  return <JudgementWorkspace
    rows={rows as never}
    year={year}
    role={role}
    actorName={auth.displayName || auth.email || "You"}
    sourceDate={latestSource?.source_last_seen_at || null}
    queryError={queryError}
  />;
}
