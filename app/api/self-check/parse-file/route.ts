import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { workbookToMatrix } from "@/lib/intake/xlsx";

export const runtime = "nodejs";
export const maxDuration = 45;
const MAX_BYTES = 20 * 1024 * 1024;

/** Read a staged XLSX/CSV (uploaded to the private bucket first) into a table. PDFs are never read here. */
export async function POST(request: NextRequest) {
  const auth = await getAuthContext();
  if (!auth.configured) return NextResponse.json({ error: "Supabase is required for secure file reading." }, { status: 503 });
  if (!auth.userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!auth.role || !["supplier", "admin", "preparer", "reviewer"].includes(auth.role)) return NextResponse.json({ error: "Supplier or internal reviewer role required." }, { status: 403 });
  const body = await request.json().catch(() => null) as { storagePath?: string; fileName?: string; classification?: string } | null;
  if (!body?.storagePath || !body.fileName) return NextResponse.json({ error: "storagePath and fileName are required." }, { status: 400 });
  if (!body.storagePath.startsWith(`${auth.userId}/`)) return NextResponse.json({ error: "File is outside your private upload folder." }, { status: 403 });
  if (!["PROTECTED", "INTERNAL", "PUBLIC"].includes(body.classification || "")) return NextResponse.json({ error: "CONFIDENTIAL and UNKNOWN files cannot be processed." }, { status: 422 });
  const ext = body.fileName.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return NextResponse.json({ error: "PDF files are attached for manual review and are not read automatically." }, { status: 422 });
  if (ext !== "xlsx" && ext !== "csv") return NextResponse.json({ error: "Only XLSX or CSV can be read." }, { status: 415 });
  const supabase = (await createClient())!;
  const { data: stored, error } = await supabase.storage.from("supplier-precheck-private").download(body.storagePath);
  if (error || !stored) return NextResponse.json({ error: error?.message || "Uploaded file not found." }, { status: 404 });
  if (stored.size > MAX_BYTES) return NextResponse.json({ error: "File exceeds 20 MB." }, { status: 413 });
  try {
    const out = await workbookToMatrix(Buffer.from(await stored.arrayBuffer()), ext);
    const size = JSON.stringify(out.matrix).length;
    if (size > 3_500_000) return NextResponse.json({ error: "This sheet is too wide or long to check in one go. Keep only the part-number, CAS, content, material and mass columns, or paste the cells instead." }, { status: 413 });
    return NextResponse.json({ matrix: out.matrix, sheetName: out.sheetName, sheets: out.sheets, truncated: out.truncated }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "The file could not be read." }, { status: 422 }); }
}
