import { redirect } from "next/navigation";
import { uniqueById } from "@/lib/judgement/ids";
import { pick } from "@/lib/judgement/gcats-detail";
import { createClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/lib/auth/session";
import { JudgementWorkspace } from "@/components/judgement-workspace";
import { extractRowFacts } from "@/lib/judgement/row-facts";

export const dynamic = "force-dynamic";

export default async function JudgementPage({ searchParams }: { searchParams: Promise<{ q?: string; autojudge?: string }> }) {
  const params = await searchParams;
  const initialSearch = String(params.q || "").slice(0, 80);
  const openAutoJudgeSettings = params.autojudge === "settings";
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
    // Every G-CATS row of this year, whichever import last refreshed it (a daily file only carries that day's
    // rows; filtering on the newest batch would hide everything else). Pages are fetched in parallel.
    const BASE = "id,source_record_key,error_type_label,delivery_part_no,supplier_code,source_status,source_year,source_month,judge,km_judge,source_judge_label,source_km_judge_label,assigned_person,starting_date,judgement_procedure,ok_comment,imds_reject_comment,last_change_date,case_id";
    const pageSize = 1000;
    const query = (cols: string, from: number) => supabase.from("gcat_error_items").select(cols)
      .eq("source_year", String(year))
      .order("source_month", { ascending: false })
      .order("last_change_date", { ascending: false, nullsFirst: true })
      // Unique tiebreaker: without it offset pages can repeat or skip rows with equal sort keys.
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    const { count, error: countError } = await supabase.from("gcat_error_items").select("id", { count: "exact", head: true }).eq("source_year", String(year));
    if (countError) queryError = countError.message;
    const pages = Math.max(1, Math.ceil((count || 0) / pageSize));
    async function loadAll(cols: string) {
      const out: Array<Record<string, unknown>> = [];
      for (let p = 0; p < pages; p += 4) {
        const batch = await Promise.all(Array.from({ length: Math.min(4, pages - p) }, (_, k) => query(cols, (p + k) * pageSize)));
        for (const r of batch) { if (r.error) return { out, error: r.error.message }; out.push(...((r.data || []) as unknown as Array<Record<string, unknown>>)); }
      }
      return { out, error: null as string | null };
    }
    // Fast path: only the three raw_source values the list shows (computed field, migration 20261119040000).
    let res = await loadAll(BASE + ",judge_facts");
    const slim = !res.error;
    if (res.error) res = await loadAll(BASE + ",raw_source");   // migration not run yet: same result, slower
    if (res.error) queryError = res.error;
    const clean = (v: unknown) => { const t = String(v ?? "").replace(/_x000D_/g, " ").replace(/\u00a0/g, " ").trim(); return !t || t === "***" || /^#(N\/A|VALUE!|REF!|DIV\/0!)/i.test(t) ? "" : t; };
    rows = uniqueById(res.out).map(({ raw_source, judge_facts, ...rest }) => {
      if (slim) { const f = (judge_facts || {}) as Record<string, unknown>; return { ...rest, cas: clean(f.cas), substance_name: clean(f.substance), comment_last_time: clean(f.commentLast) }; }
      // Only display fields go to the browser; source evidence stays on the server.
      const f = extractRowFacts(raw_source as Record<string, unknown> | null);
      return { ...rest, cas: f.cas, substance_name: f.substanceName, comment_last_time: pick(raw_source as Record<string, unknown> | null, "Comment(last time)", "Comment (last time)") };
    });
  }

  return <JudgementWorkspace
    rows={rows as never}
    year={year}
    role={role}
    actorName={auth.displayName || auth.email || "You"}
    sourceDate={latestSource?.source_last_seen_at || null}
    queryError={queryError}
    initialSearch={initialSearch}
    openAutoJudgeSettings={openAutoJudgeSettings}
  />;
}
