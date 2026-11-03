import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
export async function GET() {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ batches: [], mode: "local-preview" });
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (!profile || !["admin", "preparer", "reviewer", "viewer"].includes(profile.role)) return NextResponse.json({ error: "Internal workspace access required." }, { status: 403 });
  const { data, error } = await supabase.from("import_batches").select("id,file_name,source_sheet,total_rows,committed_rows,status,created_at,committed_at,metadata").order("created_at", { ascending: false }).limit(20);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ batches: data || [] }, { headers: { "Cache-Control": "no-store" } });
}
