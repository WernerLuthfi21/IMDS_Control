import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
const MAX = 20 * 1024 * 1024;
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is required to store supplier pre-check attachments." }, { status: 503 });
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (!profile || !["supplier", "admin", "preparer"].includes(profile.role)) return NextResponse.json({ error: "Supplier or internal preparer role required." }, { status: 403 });
  const body = await request.json().catch(() => null) as { fileName?: string; fileSize?: number; classification?: string } | null;
  if (!body?.fileName || !Number.isFinite(body.fileSize) || Number(body.fileSize) > MAX) return NextResponse.json({ error: "Attachment missing or exceeds 20 MB." }, { status: 413 });
  if (!["PROTECTED", "INTERNAL", "PUBLIC"].includes(body.classification || "")) return NextResponse.json({ error: "CONFIDENTIAL or UNKNOWN attachments are blocked." }, { status: 422 });
  const ext = body.fileName.split(".").pop()?.toLowerCase();
  if (!["pdf", "xlsx", "csv"].includes(ext || "")) return NextResponse.json({ error: "Only PDF attachment, XLSX or CSV are accepted." }, { status: 415 });
  const safe = body.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
  const path = `${auth.user.id}/${Date.now()}_${safe}`;
  const { data, error } = await supabase.storage.from("supplier-precheck-private").createSignedUploadUrl(path);
  if (error || !data) return NextResponse.json({ error: error?.message || "Could not create signed upload." }, { status: 500 });
  return NextResponse.json({ path, token: data.token });
}
