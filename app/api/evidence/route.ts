import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ evidence: [], mode: "local-preview" });
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (!profile || !["admin", "preparer", "reviewer", "viewer"].includes(profile.role)) return NextResponse.json({ error: "Internal workspace access required." }, { status: 403 });
  const caseId = request.nextUrl.searchParams.get("caseId");
  if (!caseId || !/^[0-9a-f-]{36}$/i.test(caseId)) return NextResponse.json({ error: "A valid caseId is required." }, { status: 400 });
  const { data, error } = await supabase.from("evidence").select("id,file_name,created_at,classification,source_page,source_sheet,source_row")
    .eq("case_id", caseId).order("created_at", { ascending: false }).limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ evidence: data || [] }, { headers: { "Cache-Control": "no-store" } });
}
