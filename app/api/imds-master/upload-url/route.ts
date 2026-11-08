import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { MAX_IMPORT_BYTES } from "@/lib/imds-master/upload";

export const runtime = "nodejs";

/** Step 1 of a Tracker import: a signed URL so the browser uploads the workbook straight to private storage. */
export async function POST(request: NextRequest) {
  const auth = await getAuthContext();
  if (!auth.configured) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  if (!auth.userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!["admin", "preparer"].includes(auth.role || "")) return NextResponse.json({ error: "Admin or preparer role is required to import." }, { status: 403 });
  const body = await request.json().catch(() => null) as { fileName?: string; fileSize?: number } | null;
  if (!body?.fileName?.toLowerCase().endsWith(".xlsx")) return NextResponse.json({ error: "Only .xlsx workbooks are supported." }, { status: 415 });
  if (!Number.isFinite(body.fileSize) || Number(body.fileSize) > MAX_IMPORT_BYTES) return NextResponse.json({ error: "File exceeds the 20 MB upload limit." }, { status: 413 });
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const safe = body.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
  const path = `${auth.userId}/${Date.now()}_${safe}`;
  const { data, error } = await supabase.storage.from("import-staging").createSignedUploadUrl(path);
  if (error || !data) return NextResponse.json({ error: error?.message || "Could not prepare the upload." }, { status: 500 });
  return NextResponse.json({ path, token: data.token });
}
