import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const fields = "source_record_key,judgement_procedure,ok_comment,imds_reject_comment,judge,km_judge,delivery_part_no,supplier_code,cas_no";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const errorType = params.get("errorType")?.trim();
  if (!errorType) return NextResponse.json({ suggestions: [] });
  const partNo = params.get("partNo")?.trim() || "";
  const supplierCode = params.get("supplierCode")?.trim() || "";
  const casNo = params.get("casNo")?.trim() || "";
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ suggestions: [], mode: "local-preview" });

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (!profile || !["admin", "preparer", "reviewer", "viewer"].includes(profile.role)) {
    return NextResponse.json({ error: "Internal workspace access required." }, { status: 403 });
  }

  // Query independent contexts and merge them. Filtering the base query to CAS alone
  // would hide useful same-part or same-supplier cases whose CAS differs/is blank.
  const query = () => supabase.from("gcat_error_items").select(fields)
    .eq("error_type_label", errorType).not("judgement_procedure", "is", null)
    .order("last_change_date", { ascending: false, nullsFirst: false }).limit(300);
  const jobs = [query()];
  if (partNo) jobs.push(query().eq("delivery_part_no", partNo));
  if (supplierCode) jobs.push(query().eq("supplier_code", supplierCode));
  if (casNo) jobs.push(query().eq("cas_no", casNo));
  const results = await Promise.all(jobs);
  const errorResult = results.find(result => result.error);
  if (errorResult?.error) return NextResponse.json({ error: errorResult.error.message }, { status: 500 });

  const rows = new Map<string, any>();
  for (const result of results) for (const row of result.data || []) rows.set(row.source_record_key, row);
  const groups = new Map<string, { procedure: string; count: number; okComment?: string; rejectComment?: string; sampleJudge?: string; samePartCount: number; sameSupplierCount: number; sameCasCount: number; latestDate: string | null }>();
  for (const row of rows.values()) {
    const procedure = String(row.judgement_procedure || "").trim();
    if (!procedure) continue;
    const key = procedure.toLowerCase().replace(/\s+/g, " ");
    const current = groups.get(key) || {
      procedure, count: 0, okComment: row.ok_comment || undefined,
      rejectComment: row.imds_reject_comment || undefined, sampleJudge: row.judge || undefined,
      samePartCount: 0, sameSupplierCount: 0, sameCasCount: 0, latestDate: null
    };
    current.count += 1;
    if (partNo && row.delivery_part_no === partNo) current.samePartCount += 1;
    if (supplierCode && row.supplier_code === supplierCode) current.sameSupplierCount += 1;
    if (casNo && row.cas_no === casNo) current.sameCasCount += 1;
    groups.set(key, current);
  }
  const suggestions = [...groups.values()].sort((a, b) =>
    (b.samePartCount - a.samePartCount) || (b.sameCasCount - a.sameCasCount) ||
    (b.sameSupplierCount - a.sameSupplierCount) || (b.count - a.count)
  ).slice(0, 5);
  return NextResponse.json({
    suggestions, sampledRecords: rows.size,
    source: "Imported historical judgement register; same part, CAS and supplier contexts are queried independently. Suggestions are not final decisions. Verify current evidence and rule version."
  }, { headers: { "Cache-Control": "no-store" } });
}
