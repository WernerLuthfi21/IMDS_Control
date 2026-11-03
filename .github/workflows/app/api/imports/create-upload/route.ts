import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { canProcessClassification, classificationBlockReason } from "@/lib/security/classification";
import { maxImportFileMb } from "@/lib/config";
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is required for persistent workbook uploads." }, { status: 503 });
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (!profile || !["admin", "preparer"].includes(profile.role)) return NextResponse.json({ error: "A preparer or admin role is required." }, { status: 403 });
  const body = await request.json().catch(() => null) as { fileName?: string; fileSize?: number; classification?: string } | null;
  if (!body?.fileName || !body.fileName.toLowerCase().endsWith(".xlsx")) return NextResponse.json({ error: "A valid .xlsx filename is required." }, { status: 400 });
  if (!canProcessClassification(body.classification)) return NextResponse.json({ error: classificationBlockReason(body.classification) }, { status: 422 });
  if (!Number.isFinite(body.fileSize) || !body.fileSize || body.fileSize > maxImportFileMb * 1024 * 1024) return NextResponse.json({ error: `File size must be between 1 byte and ${maxImportFileMb} MB.` }, { status: 413 });
  const safeName = body.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
  const path = `${auth.user.id}/${randomUUID()}-${safeName}`;
  const { data, error } = await supabase.storage.from("import-staging").createSignedUploadUrl(path);
  if (error || !data) return NextResponse.json({ error: error?.message || "Could not create signed upload URL." }, { status: 500 });
  return NextResponse.json({ path: data.path, token: data.token, signedUrl: data.signedUrl }, { headers: { "Cache-Control": "no-store" } });
}
