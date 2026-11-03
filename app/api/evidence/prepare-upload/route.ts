import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { canProcessClassification, classificationBlockReason } from "@/lib/security/classification";
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Evidence storage requires Supabase." }, { status: 503 });
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (!profile || !["admin", "preparer", "reviewer"].includes(profile.role)) return NextResponse.json({ error: "Preparer, reviewer or admin role is required." }, { status: 403 });
  const body = await request.json().catch(() => null) as { caseId?: string; fileName?: string; fileSize?: number; classification?: string } | null;
  if (!body?.caseId || !/^[0-9a-f-]{36}$/i.test(body.caseId)) return NextResponse.json({ error: "A valid caseId is required." }, { status: 400 });
  if (!canProcessClassification(body.classification)) return NextResponse.json({ error: classificationBlockReason(body.classification) }, { status: 422 });
  if (!body.fileName || body.fileName.length > 160) return NextResponse.json({ error: "A valid filename is required." }, { status: 400 });
  if (!Number.isFinite(body.fileSize) || !body.fileSize || body.fileSize > 20 * 1024 * 1024) return NextResponse.json({ error: "Evidence must be between 1 byte and 20 MB." }, { status: 413 });
  const { data: existingCase, error: caseError } = await supabase.from("gcat_cases").select("id").eq("id", body.caseId).maybeSingle();
  if (caseError || !existingCase) return NextResponse.json({ error: "Case not found." }, { status: 404 });
  const safeName = body.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
  const path = `${auth.user.id}/${body.caseId}/${randomUUID()}-${safeName}`;
  const { data, error } = await supabase.storage.from("evidence-private").createSignedUploadUrl(path);
  if (error || !data) return NextResponse.json({ error: error?.message || "Could not create evidence upload URL." }, { status: 500 });
  return NextResponse.json({ path: data.path, token: data.token }, { headers: { "Cache-Control": "no-store" } });
}
