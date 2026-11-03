import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid pre-check id." }, { status: 400 });
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role,supplier_code").eq("id", auth.user.id).maybeSingle();
  if (!profile) return NextResponse.json({ error: "Profile not found." }, { status: 403 });
  const { data: row, error } = await supabase.from("supplier_prechecks")
    .select("id,supplier_code,attachment_path,attachment_name")
    .eq("id", id).single();
  if (error || !row) return NextResponse.json({ error: "Pre-check not found." }, { status: 404 });
  const internal = ["admin", "preparer", "reviewer"].includes(profile.role);
  const owner = profile.role === "supplier" && profile.supplier_code === row.supplier_code;
  if (!internal && !owner) return NextResponse.json({ error: "You cannot access this supplier attachment." }, { status: 403 });
  if (!row.attachment_path) return NextResponse.json({ error: "No attachment was uploaded for this pre-check." }, { status: 404 });
  const { data: signed, error: signedError } = await supabase.storage.from("supplier-precheck-private").createSignedUrl(row.attachment_path, 120);
  if (signedError || !signed?.signedUrl) return NextResponse.json({ error: signedError?.message || "Could not create a private attachment link." }, { status: 404 });
  return NextResponse.json({ url: signed.signedUrl, fileName: row.attachment_name }, { headers: { "Cache-Control": "no-store" } });
}
