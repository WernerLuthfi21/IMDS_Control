import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { canAccessImdsTracker } from "@/lib/security/imds-tracker";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await getAuthContext();
  if (!auth.configured) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  if (!auth.userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!canAccessImdsTracker(auth.role)) return NextResponse.json({ error: "Internal workspace access required." }, { status: 403 });

  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });

  const params = request.nextUrl.searchParams;
  const page = Math.max(1, Math.min(10000, Number(params.get("page") || 1)));
  const pageSize = Math.max(10, Math.min(100, Number(params.get("pageSize") || 50)));
  const q = (params.get("q") || "").replace(/[^a-zA-Z0-9 ._\-/]/g, "").trim().slice(0, 80);
  const project = (params.get("project") || "").trim().slice(0, 50);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("imds_master_parts")
    .select("id,master_key,project,vendor_code,main_pic_email,company_name,part_name,part_no,submission_plan,supplier_promise_date,imds_status,imds_id_version,part_status,have_respond_email,status_update,md_id_version,md_status_update_date,comment,lpop_confirmation,cek,md_system_records,md_system_updated_at,manual_overrides,extra_fields,source_row,updated_at", { count: "exact" })
    .order("project", { ascending: true, nullsFirst: true })
    .order("company_name", { ascending: true, nullsFirst: true })
    .order("part_no", { ascending: true, nullsFirst: true })
    .range(from, to);

  if (project) query = query.eq("project", project);
  if (q) query = query.or(`part_no.ilike.%${q}%,company_name.ilike.%${q}%,part_name.ilike.%${q}%,vendor_code.ilike.%${q}%`);

  const [{ data: rows, error, count }, { data: masterBatches }, { data: mdsBatches }] = await Promise.all([
    query,
    supabase.from("imds_master_import_batches").select("id,file_name,total_rows,inserted_rows,updated_rows,skipped_rows,created_at").order("created_at", { ascending: false }).limit(1),
    supabase.from("imds_mds_import_batches").select("id,file_name,total_rows,matched_master_rows,unmatched_part_numbers,metadata,created_at").order("created_at", { ascending: false }).limit(12)
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    rows: rows || [],
    total: count || 0,
    page,
    pageSize,
    latestMasterImport: masterBatches?.[0] || null,
    latestMdsImport: mdsBatches?.[0] || null,
    mdsImports: (mdsBatches || []).map((b) => { const m = (b.metadata || {}) as Record<string, unknown>; return { id: b.id, file_name: b.file_name, created_at: b.created_at, total_rows: b.total_rows, matched: b.matched_master_rows, unmatched: b.unmatched_part_numbers, periodFrom: m.periodFrom ?? null, periodTo: m.periodTo ?? null }; })
  }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
