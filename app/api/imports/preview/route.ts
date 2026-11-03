import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { canProcessClassification, classificationBlockReason } from "@/lib/security/classification";
import { maxImportFileMb } from "@/lib/config";

export const runtime = "nodejs";
export const maxDuration = 60;
const MAX_ROWS = 100_000;
const MAX_COLUMNS = 200;

function plain(value: ExcelJS.CellValue): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("error" in value && typeof value.error === "string") return value.error;
    if ("result" in value) return plain(value.result as ExcelJS.CellValue);
    if ("richText" in value && Array.isArray(value.richText)) return value.richText.map(x => x.text).join("");
    if ("hyperlink" in value) return String(value.text || value.hyperlink);
    return JSON.stringify(value) ?? String(value);
  }
  return String(value);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Persistent import requires Supabase. Configure .env.local and sign in first. Local demo mode does not persist imported operational data." }, { status: 503 });
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (!profile || !["admin", "preparer"].includes(profile.role)) return NextResponse.json({ error: "A preparer or admin role is required to import workbooks." }, { status: 403 });

  const body = await request.json().catch(() => null) as { storagePath?: string; fileName?: string; classification?: string } | null;
  if (!body?.storagePath || !body.fileName) return NextResponse.json({ error: "storagePath and fileName are required after secure upload." }, { status: 400 });
  if (!canProcessClassification(body.classification)) return NextResponse.json({ error: classificationBlockReason(body.classification) }, { status: 422 });
  if (!body.fileName.toLowerCase().endsWith(".xlsx")) return NextResponse.json({ error: "Only .xlsx workbooks are accepted." }, { status: 415 });
  if (!body.storagePath.startsWith(`${auth.user.id}/`)) return NextResponse.json({ error: "Upload path is outside the current user's staging namespace." }, { status: 403 });
  const { data: storedFile, error: downloadError } = await supabase.storage.from("import-staging").download(body.storagePath);
  if (downloadError || !storedFile) return NextResponse.json({ error: downloadError?.message || "Staged upload not found." }, { status: 404 });
  if (storedFile.size > maxImportFileMb * 1024 * 1024) return NextResponse.json({ error: `File exceeds ${maxImportFileMb} MB.` }, { status: 413 });
  const fileName = body.fileName;
  const buffer = Buffer.from(await storedFile.arrayBuffer());
  const hash = createHash("sha256").update(buffer).digest("hex");
  const workbook = new ExcelJS.Workbook();
  // ExcelJS expects its own Buffer declaration; the runtime value is a Node Buffer.
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  let sheet = workbook.getWorksheet("G-CATS Error Log Master Data");
  if (!sheet) sheet = workbook.worksheets.find(ws => {
    for (let r = 1; r <= Math.min(ws.rowCount, 12); r++) {
      const vals = ws.getRow(r).values as unknown[];
      if (vals.some(v => String(plain(v as ExcelJS.CellValue) ?? "").trim().toLowerCase() === "error type")) return true;
    }
    return false;
  });
  if (!sheet) return NextResponse.json({ error: "Could not find a sheet/header row containing 'Error Type'." }, { status: 422 });

  let headerRow = 0;
  let errorCol = 0;
  for (let r = 1; r <= Math.min(sheet.rowCount, 20); r++) {
    const row = sheet.getRow(r);
    for (let c = 1; c <= Math.min(row.cellCount, MAX_COLUMNS); c++) {
      if (String(plain(row.getCell(c).value) ?? "").trim().toLowerCase() === "error type") { headerRow = r; errorCol = c; break; }
    }
    if (headerRow) break;
  }
  if (!headerRow) return NextResponse.json({ error: "Error Type header was not found in the first 20 rows." }, { status: 422 });
  const headers = Array.from({ length: Math.min(sheet.columnCount, MAX_COLUMNS) }, (_, index) => {
    const raw = plain(sheet!.getRow(headerRow).getCell(index + 1).value);
    return String(raw ?? "").trim();
  });
  const normHeader = (value: string) => value.replace(/\s+/g, " ").replace(/[“”]/g, '"').trim().toLowerCase();
  const findCol = (names: string[]) => {
    for (const name of names) { const index = headers.findIndex(h => normHeader(h) === normHeader(name)); if (index >= 0) return index + 1; }
    return 0;
  };
  const findColContaining = (phrase: string) => { const index = headers.findIndex(h => normHeader(h).includes(normHeader(phrase))); return index >= 0 ? index + 1 : 0; };
  // `code` is the stable source record identifier. `No.` is only a daily row sequence and repeats each export.
  const cols = {
    sourceCode: findCol(["code"]),
    sequenceNo: findCol(["No.", "No"]),
    year: findCol(["Year"]), month: findCol(["Month"]), downloadDate: findCol(["Download Date"]),
    status: findCol(["Status"]),
    errorType: errorCol,
    part: findCol(["Delivery Part No", "Part number", "Delivery Part No."]),
    partName: findCol(["Delivery Part Name"]),
    supplier: findCol(["Supplier Code"]),
    company: findCol(["Company Name"]),
    businessEntity: findCol(["Bus.Ent.", "Business Entity"]),
    module: findCol(["Module ID"]),
    cas: findCol(["CAS No.", "CAS No"]),
    substance: findCol(["Substance Name"]),
    judge: findCol(["Judge (OK/NG)", "Judge"]),
    assignedPerson: findCol(["Assigned person"]),
    startingDate: findCol(["The starting date"]),
    judgementProcedure: findCol(["Judgment  procedure", "Judgment procedure"]),
    okComment: findColContaining("Record of changing to"),
    rejectComment: findCol(["IMDS Reject comment"]),
    kmJudge: findCol(["KM Judge (OK/NG)"]),
    kmComment: findCol(["KM  Comment", "KM Comment"]),
    lastChangeDate: findCol(["Last Change Date"]),
    comment: findCol(["Comment(last time)", "Comment"])
  };
  const missing = ["errorType", "part", "supplier"].filter(key => !cols[key as keyof typeof cols]);
  if (missing.length) return NextResponse.json({ error: `Required columns are missing: ${missing.join(", ")}.` }, { status: 422 });
  const lastRow = Math.min(sheet.rowCount, headerRow + MAX_ROWS);
  const rows: Array<{source_sheet:string;source_row:number;source_case_code:string;row_data:Record<string,unknown>;normalized:Record<string,unknown>;validation_state:string;validation_messages:string[]}> = [];
  const counts: Record<string, number> = {};
  const caseCodes = new Set<string>();
  const warnings: string[] = [];
  const dateValue = (currentRow: ExcelJS.Row, column: number) => {
    if (!column) return null;
    const raw = currentRow.getCell(column).value;
    if (raw instanceof Date) return raw.toISOString().slice(0, 10);
    const value = plain(raw as ExcelJS.CellValue);
    if (typeof value === "number" && value > 20000 && value < 80000) return new Date(Date.UTC(1899, 11, 30) + value * 86400000).toISOString().slice(0, 10);
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
    return null;
  };
  for (let r = headerRow + 1; r <= lastRow; r++) {
    const row = sheet.getRow(r);
    const values: Record<string, unknown> = {};
    let any = false;
    for (let c = 1; c <= headers.length; c++) {
      const val = plain(row.getCell(c).value);
      if (val !== null) any = true;
      const key = headers[c - 1] ? `${headers[c - 1]} [col ${c}]` : `Column ${c}`;
      values[key] = val;
    }
    if (!any) continue;
    const type = String(plain(row.getCell(cols.errorType).value) ?? "").trim();
    const part = String(plain(row.getCell(cols.part).value) ?? "").trim();
    const supplier = String(plain(row.getCell(cols.supplier).value) ?? "").trim();
    const sourceCode = cols.sourceCode ? String(plain(row.getCell(cols.sourceCode).value) ?? "").trim() : "";
    const sourceJudgeLabel = cols.judge ? String(plain(row.getCell(cols.judge).value) ?? "").replace(/\u00a0/g, " ").trim() : "";
    const sourceKmJudgeLabel = cols.kmJudge ? String(plain(row.getCell(cols.kmJudge).value) ?? "").replace(/\u00a0/g, " ").trim() : "";
    const validJudge = ["OK", "NG"].includes(sourceJudgeLabel.toUpperCase()) ? sourceJudgeLabel.toUpperCase() : null;
    const validKmJudge = ["OK", "NG"].includes(sourceKmJudgeLabel.toUpperCase()) ? sourceKmJudgeLabel.toUpperCase() : null;
    const sourceCaseCode = sourceCode ? `code:${sourceCode}` : `fallback:${hash.slice(0, 16)}:${sheet.name}:${r}`;
    counts[type || "(blank)"] = (counts[type || "(blank)"] || 0) + 1;
    caseCodes.add(sourceCaseCode);
    const messages: string[] = [];
    if (!type) messages.push("Blank Error Type");
    if (!part) messages.push("Blank Delivery Part No");
    if (!supplier) messages.push("Blank Supplier Code");
    rows.push({
      source_sheet: sheet.name,
      source_row: r,
      source_case_code: sourceCaseCode,
      row_data: values,
      normalized: {
        sourceRecordKey: sourceCaseCode, sourceCode: sourceCode || null,
        sequenceNo: cols.sequenceNo ? plain(row.getCell(cols.sequenceNo).value) : null,
        year: cols.year ? plain(row.getCell(cols.year).value) : null,
        month: cols.month ? plain(row.getCell(cols.month).value) : null,
        downloadDate: dateValue(row, cols.downloadDate), sourceStatus: cols.status ? plain(row.getCell(cols.status).value) : null,
        errorType: type, deliveryPartNo: part, deliveryPartName: cols.partName ? plain(row.getCell(cols.partName).value) : null,
        supplierCode: supplier, companyName: cols.company ? plain(row.getCell(cols.company).value) : null,
        businessEntity: cols.businessEntity ? plain(row.getCell(cols.businessEntity).value) : null,
        moduleId: cols.module ? plain(row.getCell(cols.module).value) : null,
        casNo: cols.cas ? plain(row.getCell(cols.cas).value) : null,
        substanceName: cols.substance ? plain(row.getCell(cols.substance).value) : null,
        assignedPerson: cols.assignedPerson ? plain(row.getCell(cols.assignedPerson).value) : null,
        startingDate: dateValue(row, cols.startingDate),
        judgementProcedure: cols.judgementProcedure ? plain(row.getCell(cols.judgementProcedure).value) : null,
        judge: validJudge, sourceJudgeLabel: sourceJudgeLabel || null,
        okComment: cols.okComment ? plain(row.getCell(cols.okComment).value) : null,
        imdsRejectComment: cols.rejectComment ? plain(row.getCell(cols.rejectComment).value) : null,
        kmJudge: validKmJudge, sourceKmJudgeLabel: sourceKmJudgeLabel || null,
        kmComment: cols.kmComment ? plain(row.getCell(cols.kmComment).value) : null,
        lastChangeDate: dateValue(row, cols.lastChangeDate),
        comment: cols.comment ? plain(row.getCell(cols.comment).value) : null
      },
      validation_state: messages.length ? "WARNING" : "PENDING", validation_messages: messages
    });
  }
  if (sheet.rowCount > lastRow) warnings.push(`Only the first ${MAX_ROWS.toLocaleString()} data rows were staged; the workbook contains more rows.`);
  if (headers.filter(h => h === "Delivery Part No").length > 1) warnings.push("Duplicate Delivery Part No headers were detected and kept distinct by source column index.");
  if (!cols.sourceCode) warnings.push("No stable `code` column was found. Fallback source identity uses sheet and row number; row reordering can create a new record rather than risk false merging.");
  if (cols.sequenceNo && cols.sourceCode) warnings.push("The repeating `No.` sequence is retained separately and is NOT used as a record key. The `code` column is the source identity.");
  const judgementFieldsDetected = [cols.assignedPerson, cols.startingDate, cols.judgementProcedure, cols.judge, cols.okComment, cols.rejectComment, cols.kmJudge, cols.kmComment, cols.lastChangeDate].filter(Boolean).length;
  const warningRows = rows.filter(row => row.validation_messages.length > 0).length;
  if (judgementFieldsDetected < 9) warnings.push(`Only ${judgementFieldsDetected}/9 AO–AW judgement columns were detected by header. Their original cells remain preserved in row_data for review.`);
  const nonstandardJudgeLabels = new Set(rows.map(r => String(r.normalized.sourceJudgeLabel || "").trim()).filter(v => v && !["OK", "NG"].includes(v.toUpperCase())));
  const nonstandardKmLabels = new Set(rows.map(r => String(r.normalized.sourceKmJudgeLabel || "").trim()).filter(v => v && !["OK", "NG"].includes(v.toUpperCase())));
  if (nonstandardJudgeLabels.size || nonstandardKmLabels.size) warnings.push(`Historical non-standard judgement labels retained as source text (not converted into a new OK/NG decision): ${nonstandardJudgeLabels.size} Judge labels and ${nonstandardKmLabels.size} KM Judge labels.`);
  const sourceKeys = rows.map(row => String(row.normalized.sourceRecordKey));
  const existingByKey = new Map<string, string | null>();
  for (let i = 0; i < sourceKeys.length; i += 300) {
    const chunk = sourceKeys.slice(i, i + 300);
    const { data: existingRows, error: existingError } = await supabase.from("gcat_error_items").select("source_record_key,source_hash").in("source_record_key", chunk);
    if (existingError) return NextResponse.json({ error: `Could not compare with the current register: ${existingError.message}` }, { status: 500 });
    for (const existing of existingRows || []) existingByKey.set(existing.source_record_key, existing.source_hash ?? null);
  }
  const newRecords = sourceKeys.filter(key => !existingByKey.has(key)).length;
  const sameSnapshotRows = sourceKeys.filter(key => existingByKey.get(key) === hash).length;
  const refreshedRecords = sourceKeys.length - newRecords - sameSnapshotRows;
  const { data: batch, error: batchError } = await supabase.from("import_batches").insert({ file_name: fileName, source_file_hash: hash, source_sheet: sheet.name, header_row: headerRow, total_rows: rows.length, uploaded_by: auth.user.id, metadata: { classification: body.classification, columns: cols, headerCount: headers.length, sourceHash: hash } }).select("id").single();
  if (batchError || !batch) return NextResponse.json({ error: batchError?.message || "Failed to create import batch." }, { status: 500 });
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map(row => ({ ...row, batch_id: batch.id }));
    const { error } = await supabase.from("import_rows").insert(chunk);
    if (error) { await supabase.from("import_batches").update({ status: "FAILED", validation_errors: [{ error: error.message }] }).eq("id", batch.id); return NextResponse.json({ error: `Staging failed: ${error.message}` }, { status: 500 }); }
  }
  await supabase.from("audit_events").insert({ actor_id: auth.user.id, action: "IMPORT_STAGED", entity_type: "import_batch", entity_id: batch.id, metadata: { fileName, classification: body.classification, rows: rows.length, sheet: sheet.name, hash } });
  return NextResponse.json({ preview: { batchId: batch.id, fileName, sheetName: sheet.name, headerRow, rowCount: rows.length, errorRows: warningRows, caseCount: caseCodes.size, newRecords, refreshedRecords, sameSnapshotRows, judgementFieldsDetected, typeCounts: counts, warnings, sampleRows: rows.slice(0, 5).map(r => r.normalized) } }, { headers: { "Cache-Control": "no-store" } });
}
