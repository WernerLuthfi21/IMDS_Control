import { NextRequest, NextResponse } from "next/server";
import { trackerAuth } from "@/lib/imds-tracker/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const ctx = await trackerAuth(["admin", "preparer", "reviewer", "viewer"]);
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  const { searchParams } = request.nextUrl;
  const project = searchParams.get("project") || "";
  const status = searchParams.get("status") || "";
  const supplier = searchParams.get("supplier") || "";
  const query = (searchParams.get("q") || "").trim();
  const page = Math.max(1, Number(searchParams.get("page") || 1));
  const pageSize = Math.min(100, Math.max(10, Number(searchParams.get("pageSize") || 50)));
  let builder = ctx.supabase.from("imds_master_parts").select("*", { count: "exact" }).order("project").order("company_name").order("part_no");
  if (project) builder = builder.eq("project", project);
  if (status) builder = builder.eq("imds_status", status);
  if (supplier) builder = builder.eq("company_name", supplier);
  if (query) builder = builder.or(`part_no.ilike.%${query.replace(/[%_,]/g, " ")}%,company_name.ilike.%${query.replace(/[%_,]/g, " ")}%,part_name.ilike.%${query.replace(/[%_,]/g, " ")}%,vendor_code.ilike.%${query.replace(/[%_,]/g, " ")}%`);
  const from = (page - 1) * pageSize;
  const { data, error, count } = await builder.range(from, from + pageSize - 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ parts: data || [], total: count || 0, page, pageSize }, { headers: { "Cache-Control": "private, no-store" } });
}
