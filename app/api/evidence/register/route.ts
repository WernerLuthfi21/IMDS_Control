import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canProcessClassification, classificationBlockReason } from "@/lib/security/classification";
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Evidence registration requires Supabase." }, { status: 503 });
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const body = await request.json().catch(() => null) as { caseId?: string; path?: string; fileName?: string; mimeType?: string; classification?: string; sourcePage?: number; sourceSheet?: string; sourceRow?: number } | null;
  if (!body?.caseId || !/^[0-9a-f-]{36}$/i.test(body.caseId)) return NextResponse.json({ error: "A valid caseId is required." }, { status: 400 });
  if (!canProcessClassification(body.classification)) return NextResponse.json({ error: classificationBlockReason(body.classification) }, { status: 422 });
  if (!body.path?.startsWith(`${auth.user.id}/${body.caseId}/`) || !body.fileName) return NextResponse.json({ error: "Evidence path or filename is invalid." }, { status: 400 });
  const { data: verifiedObject, error: objectError } = await supabase.storage.from("evidence-private").createSignedUrl(body.path, 60);
  if (objectError || !verifiedObject?.signedUrl) return NextResponse.json({ error: "Uploaded evidence object could not be verified in private storage." }, { status: 404 });
  const { data, error } = await supabase.from("evidence").insert({ case_id: body.caseId, file_name: body.fileName, storage_path: body.path, mime_type: body.mimeType || null, classification: body.classification, source_page: body.sourcePage || null, source_sheet: body.sourceSheet || null, source_row: body.sourceRow || null, uploaded_by: auth.user.id }).select("id,case_id,file_name,storage_path,mime_type,source_page,source_sheet,source_row,classification,created_at").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await supabase.from("audit_events").insert({ actor_id: auth.user.id, action: "EVIDENCE_REGISTERED", entity_type: "evidence", entity_id: data.id, metadata: { caseId: body.caseId, classification: body.classification, sourcePage: body.sourcePage, sourceSheet: body.sourceSheet, sourceRow: body.sourceRow } });
  return NextResponse.json({ evidence: data }, { status: 201 });
}
