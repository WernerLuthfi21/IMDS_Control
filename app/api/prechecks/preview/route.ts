import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { Readable } from "node:stream";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 45;
const MAX_BYTES = 20 * 1024 * 1024;
function text(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value).trim();
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text.trim();
    if ("result" in value) return text(value.result as ExcelJS.CellValue);
    if ("richText" in value && Array.isArray(value.richText)) return value.richText.map(x => x.text).join("").trim();
  }
  return "";
}
function normalizedHeader(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, "").trim(); }

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is required for secure attachment preview." }, { status: 503 });
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role,supplier_code").eq("id", auth.user.id).maybeSingle();
  if (!profile || !["supplier", "admin", "preparer"].includes(profile.role)) return NextResponse.json({ error: "Supplier or internal preparer role required." }, { status: 403 });
  const body = await request.json().catch(() => null) as { storagePath?: string; fileName?: string; classification?: string } | null;
  if (!body?.storagePath || !body.fileName) return NextResponse.json({ error: "storagePath and fileName are required." }, { status: 400 });
  if (!body.storagePath.startsWith(`${auth.user.id}/`)) return NextResponse.json({ error: "Attachment is outside your private upload namespace." }, { status: 403 });
  if (!["PROTECTED", "INTERNAL", "PUBLIC"].includes(body.classification || "")) return NextResponse.json({ error: "CONFIDENTIAL and UNKNOWN attachments cannot be processed." }, { status: 422 });
  const ext = body.fileName.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return NextResponse.json({ error: "MDS Report PDF parsing is not permitted for the supplied report. Attach it for authorised manual review instead." }, { status: 422 });
  if (!(["xlsx", "csv"].includes(ext || ""))) return NextResponse.json({ error: "Only authorized XLSX or CSV files can be previewed." }, { status: 415 });
  const { data: stored, error: downloadError } = await supabase.storage.from("supplier-precheck-private").download(body.storagePath);
  if (downloadError || !stored) return NextResponse.json({ error: downloadError?.message || "Staged attachment not found." }, { status: 404 });
  if (stored.size > MAX_BYTES) return NextResponse.json({ error: "File exceeds 20 MB." }, { status: 413 });

  const workbook = new ExcelJS.Workbook();
  const buffer = Buffer.from(await stored.arrayBuffer());
  if (ext === "csv") await workbook.csv.read(Readable.from([buffer.toString("utf8")]));
  else await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const sheet = workbook.worksheets.find(ws => ws.rowCount > 1);
  if (!sheet) return NextResponse.json({ error: "No tabular worksheet with data was found." }, { status: 422 });

  let headerRow = 1;
  let bestScore = -1;
  for (let r = 1; r <= Math.min(sheet.rowCount, 12); r++) {
    const values = sheet.getRow(r).values as unknown[];
    const score = values.map(v => normalizedHeader(String(v ?? ""))).filter(v => ["partitemno", "partnumber", "itemnumber", "suppliercode", "imdsidversion", "imdsid", "mdsstatus"].includes(v)).length;
    if (score > bestScore) { bestScore = score; headerRow = r; }
  }
  const headers = Array.from({ length: Math.min(sheet.columnCount, 200) }, (_, i) => normalizedHeader(text(sheet.getRow(headerRow).getCell(i + 1).value)));
  const find = (aliases: string[]) => {
    const normalized = aliases.map(normalizedHeader);
    const index = headers.findIndex(h => normalized.includes(h));
    return index >= 0 ? index + 1 : 0;
  };
  const columns = {
    supplierCode: find(["Supplier Code", "Supplier Number", "Company Supplier Code"]),
    supplierName: find(["Supplier Name", "Company Name", "Name"]),
    deliveryPartNo: find(["Part/Item No.", "Part Item No", "Part Number", "Item Number", "Delivery Part No"]),
    deliveryPartName: find(["Description", "Part Name", "Product Name", "Delivery Part Name"]),
    mdsIdVersion: find(["IMDS ID / Version", "IMDS ID Version", "MDS ID / Version"]),
    mdsId: find(["IMDS ID", "MDS ID", "Node ID"]),
    mdsVersion: find(["Version", "MDS Version", "IMDS Version"]),
    mdsStatus: find(["MDS Status", "Status"]),
    preliminary: find(["Preliminary MDS", "Preliminary", "Preliminary Version"])
  };
  let chosen: ExcelJS.Row | null = null;
  for (let r = headerRow + 1; r <= Math.min(sheet.rowCount, headerRow + 250); r++) {
    const row = sheet.getRow(r);
    if (columns.deliveryPartNo && text(row.getCell(columns.deliveryPartNo).value)) { chosen = row; break; }
    if (!chosen && row.cellCount > 1) chosen = row;
  }
  if (!chosen) return NextResponse.json({ error: "Could not find a data row in the selected sheet." }, { status: 422 });
  const value = (column: number) => column ? text(chosen!.getCell(column).value) : "";
  const combined = value(columns.mdsIdVersion);
  const split = combined.match(/^\s*(\d+)\s*[/| ]\s*(\d+)\s*$/);
  const fields = {
    supplierCode: value(columns.supplierCode),
    supplierName: value(columns.supplierName),
    deliveryPartNo: value(columns.deliveryPartNo),
    deliveryPartName: value(columns.deliveryPartName),
    mdsId: value(columns.mdsId) || (split ? split[1] : ""),
    mdsVersion: value(columns.mdsVersion) || (split ? split[2] : ""),
    mdsStatus: value(columns.mdsStatus),
    preliminaryMds: /^(yes|true|1)$/i.test(value(columns.preliminary)) ? true : /^(no|false|0)$/i.test(value(columns.preliminary)) ? false : null
  };
  if (profile.role === "supplier" && fields.supplierCode && fields.supplierCode !== profile.supplier_code) return NextResponse.json({ error: "The uploaded file contains a different supplier code from the supplier account." }, { status: 403 });
  const detected = Object.entries(columns).filter(([, c]) => c > 0).map(([name]) => name);
  const warnings: string[] = [];
  if (!columns.deliveryPartNo) warnings.push("Part Number column was not detected. Enter it manually.");
  if (!columns.mdsIdVersion && !(columns.mdsId && columns.mdsVersion)) warnings.push("IMDS ID / Version columns were not detected. Enter them manually.");
  if (!columns.supplierCode) warnings.push("Supplier Code was not detected. Enter or confirm it manually.");
  if (!columns.mdsStatus) warnings.push("MDS status was not detected. Confirm the current status in IMDS.");
  return NextResponse.json({ preview: { fileName: body.fileName, sheetName: sheet.name, headerRow, fields, detected, warnings, sourceFormat: ext?.toUpperCase() } }, { headers: { "Cache-Control": "no-store" } });
}
