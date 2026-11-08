// Shared by the Tracker imports: read the workbook from the private `import-staging` bucket (uploaded straight from the
// browser, so it is not limited by the ~4.5 MB serverless request-body cap) or, as a fallback, from multipart form data.
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
export type Upload = { buffer: Buffer; fileName: string } | { error: string; status: number };

export async function readUpload(request: NextRequest, supabase: SupabaseClient, userId: string): Promise<Upload> {
  const type = request.headers.get("content-type") || "";
  if (type.includes("application/json")) {
    const body = await request.json().catch(() => null) as { storagePath?: string; fileName?: string } | null;
    if (!body?.storagePath || !body.fileName) return { error: "storagePath and fileName are required.", status: 400 };
    if (!body.storagePath.startsWith(`${userId}/`)) return { error: "File is outside your private upload folder.", status: 403 };
    if (!body.fileName.toLowerCase().endsWith(".xlsx")) return { error: "Only .xlsx workbooks are supported.", status: 415 };
    const { data, error } = await supabase.storage.from("import-staging").download(body.storagePath);
    if (error || !data) return { error: error?.message || "The uploaded file was not found. Please upload it again.", status: 404 };
    if (data.size > MAX_IMPORT_BYTES) return { error: "File exceeds the 20 MB upload limit.", status: 413 };
    const buffer = Buffer.from(await data.arrayBuffer());
    void supabase.storage.from("import-staging").remove([body.storagePath]); // best effort cleanup
    return { buffer, fileName: body.fileName };
  }
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return { error: "Choose an .xlsx workbook first.", status: 400 };
  if (!file.name.toLowerCase().endsWith(".xlsx")) return { error: "Only .xlsx workbooks are supported.", status: 415 };
  if (file.size > MAX_IMPORT_BYTES) return { error: "File exceeds the 20 MB upload limit.", status: 413 };
  return { buffer: Buffer.from(await file.arrayBuffer()), fileName: file.name };
}
