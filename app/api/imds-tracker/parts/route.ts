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
  const pageSize = Math.min(500, Math.max(10, Number(searchParams.get("pageSize") || 50)));
  let builder = ctx.supabase.from("imds_master_parts").select("*", { count: "exact" }).order("project").order("company_name").order("part_no");
  if (project) builder = builder.eq("project", project);
  if (status) builder = builder.eq("imds_status", status);
  if (supplier) builder = builder.eq("company_name", supplier);
  if (query) builder = builder.or(`part_no.ilike.%${query.replace(/[%_,]/g, " ")}%,company_name.ilike.%${query.replace(/[%_,]/g, " ")}%,part_name.ilike.%${query.replace(/[%_,]/g, " ")}%,vendor_code.ilike.%${query.replace(/[%_,]/g, " ")}%`);
  if (searchParams.get("all") === "1") {
    const all: Record<string, unknown>[] = [];
    for (let from = 0; from < 10000; from += 1000) {
      const { data, error } = await builder.range(from, from + 999);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      all.push(...(data || []) as Record<string, unknown>[]);
      if ((data || []).length < 1000) break;
    }
    return NextResponse.json({ parts: all, total: count || all.length, page: 1, pageSize: all.length }, { headers: { "Cache-Control": "private, no-store" } });
  }
  const from = (page - 1) * pageSize;
  const { data, error, count } = await builder.range(from, from + pageSize - 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ parts: data || [], total: count || 0, page, pageSize }, { headers: { "Cache-Control": "private, no-store" } });
