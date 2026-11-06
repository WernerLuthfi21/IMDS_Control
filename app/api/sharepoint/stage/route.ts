import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getAuthContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { maxImportFileMb } from "@/lib/config";
import { canProcessClassification, classificationBlockReason } from "@/lib/security/classification";
import { downloadMaster, sharepointConfig } from "@/lib/sharepoint/graph";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Fetch the current SharePoint master workbook into the private import-staging bucket. The normal preview → compare → human commit flow continues from the returned path. */
export async function POST(request: NextRequest) {
  const auth = await getAuthContext();
  if (!auth.configured) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  if (!auth.userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!auth.role || !["admin", "preparer"].includes(auth.role)) return NextResponse.json({ error: "A preparer or admin role is required." }, { status: 403 });
  const body = await request.json().catch(() => null) as { classification?: string } | null;
  if (!canProcessClassification(body?.classification)) return NextResponse.json({ error: classificationBlockReason(body?.classification) }, { status: 422 });
  const cfg = sharepointConfig();
  if (!cfg.configured) return NextResponse.json({ error: `SharePoint is not configured. Missing: ${cfg.missing.join(", ")}.`, missing: cfg.missing }, { status: 503 });
  try {
    const { info, data } = await downloadMaster(maxImportFileMb * 1024 * 1024);
    if (!info.name.toLowerCase().endsWith(".xlsx")) return NextResponse.json({ error: "The SharePoint master file must be an .xlsx workbook." }, { status: 415 });
    const supabase = (await createClient())!;
    const path = `${auth.userId}/${randomUUID()}-${info.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100)}`;
    const { data: signed, error } = await supabase.storage.from("import-staging").createSignedUploadUrl(path);
    if (error || !signed) return NextResponse.json({ error: error?.message || "Could not create a staging upload." }, { status: 500 });
    const up = await supabase.storage.from("import-staging").uploadToSignedUrl(signed.path, signed.token, data, { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });
    await supabase.from("audit_events").insert({ actor_id: auth.userId, action: "SHAREPOINT_MASTER_FETCHED", entity_type: "sharepoint_file", metadata: { fileName: info.name, size: info.size, lastModified: info.lastModified, eTag: info.eTag } });
    return NextResponse.json({ storagePath: signed.path, fileName: info.name, file: info }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "SharePoint fetch failed." }, { status: 502 }); }
}
