import { NextRequest, NextResponse } from "next/server";
import { lookupSubstance } from "@/lib/reference-data";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/config";
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === "production" && !isSupabaseConfigured) return NextResponse.json({ error: "Production reference access is disabled until Supabase authentication is configured." }, { status: 503 });
  if (isSupabaseConfigured) {
    const supabase = await createClient();
    const { data: auth } = await supabase!.auth.getUser();
    if (!auth.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const cas = request.nextUrl.searchParams.get("cas") || "";
  if (!cas.trim()) return NextResponse.json({ error: "CAS query is required." }, { status: 400 });
  if (cas.length > 80) return NextResponse.json({ error: "CAS query is too long." }, { status: 400 });
  try { return NextResponse.json({ result: lookupSubstance(cas) }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Reference lookup failed." }, { status: 500 }); }
}
