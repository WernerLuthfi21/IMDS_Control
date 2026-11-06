import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { trackerAuth } from "@/lib/imds-tracker/auth";
import { buildHeaderMap, cleanCell, findHeaderRow, normalizePartNo, parseExcelDate, plainCell, uniqueEmails } from "@/lib/imds-tracker/utils";

export const runtime = "nodejs";
export const maxDuration = 60;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const CHUNK = 150;

function cell(row: ExcelJS.Row, col: number) { return col ? cleanCell(row.getCell(col).value) : ""; }

export async function POST(request: NextRequest) {
  const ctx = await trackerAuth(["admin", "preparer"]);
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose an .xlsx master workbook first." }, { status: 400 });
  if (!file.name.toLowerCase().endsWith(".xlsx")) return NextResponse.json({ error: "Only .xlsx workbooks are accepted." }, { status: 415 });
  if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "Workbook exceeds 20 MB." }, { status: 413 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const fileHash = createHash("sha256").update(buffer).digest("hex");
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Workbook could not be read." }, { status: 422 });
  }

  const sheet = workbook.getWorksheet("Part List LATEST") || workbook.worksheets.find((ws) =>
    findHeaderRow(ws, [["PROJECT"], ["COMPANY NAME"], ["P/No.", "P/No", "Part No."]], 20) > 0
  );
  if (!sheet) return NextResponse.json({ error: "Could not find a Part List LATEST sheet or a header row containing PROJECT, COMPANY NAME and P/No." }, { status: 422 });
  const headerRow = findHeaderRow(sheet, [["PROJECT"], ["COMPANY NAME"], ["P/No.", "P/No", "Part No."]], 20);
  if (!headerRow) return NextResponse.json({ error: "The required part-list headers were not found in the first 20 rows." }, { status: 422 });
  const { headers, find } = buildHeaderMap(sheet, headerRow);
  const cols = {
    no: find(["No.", "No"]),
    project: find(["PROJECT", "Project"]),
    vendorCode: find(["VENDOR CODE", "Vendor Code"]),
    pic: find(["MAIN PIC EMAIL", "Main PIC Email", "PIC Email"]),
    company: find(["COMPANY NAME", "Company Name", "Supplier"]),
    partName: find(["PART NAME", "Part Name"]),
    partNo: find(["P/No.", "P/No", "Part No.", "Part Number"]),
    submissionPlan: find(["SUBMISSION PLAN", "Submission Plan"]),
    imdsStatus: find(["IMDS STATUS", "IMDS Status"]),
    imdsIdVersion: find(["ID / Ver", "ID/Ver", "ID / Version"]),
    partStatus: find(["Part Status"]),
    haveRespondEmail: find(["Have respond email", "Have Respond Email"]),
    statusUpdate: find(["STATUS UPDATE", "Status Update"]),
    mdIdVersion: find(["ID/Ver", "ID / Ver."]),
    mdStatusDate: find(["Date", "last status changed"]),
    comment: find(["Comment"]),
    lpop: find(["LPOP Confirmation"]),
    cek: find(["CEK"])
  };
  const required = ["project", "company", "partNo"].filter((key) => !cols[key as keyof typeof cols]);
  if (required.length) return NextResponse.json({ error: `Missing required columns: ${required.join(", ")}.` }, { status: 422 });

  const rows: Array<Record<string, unknown>> = [];
  const occurrence = new Map<string, number>();
  const lastRow = Math.min(sheet.rowCount, headerRow + 100000);
  for (let rowNo = headerRow + 1; rowNo <= lastRow; rowNo++) {
    const row = sheet.getRow(rowNo);
    const rawValues = headers.map((_, i) => plainCell(row.getCell(i + 1).value));
    if (rawValues.every((value) => value === null || value === "")) continue;
    const project = cell(row, cols.project);
    const company = cell(row, cols.company);
    const partNo = cell(row, cols.partNo);
    const partName = cell(row, cols.partName);
    const vendorCode = cell(row, cols.vendorCode);
    if (!company && !partNo && !partName) continue;
    const sequence = cell(row, cols.no) || String(rowNo - headerRow);
    const identity = [vendorCode || company || "NO_VENDOR", project || "UNASSIGNED", company || "NO_COMPANY", normalizePartNo(partNo || partName), sequence]
      .map((v) => v.toUpperCase().replace(/[|\s]+/g, "_")).join("|");
    const baseKey = identity || `ROW|${rowNo}`;
    const count = (occurrence.get(baseKey) || 0) + 1;
    occurrence.set(baseKey, count);
    const masterKey = count === 1 ? baseKey : `${baseKey}|${count}`;
    const extraFields: Record<string, unknown> = {};
    headers.forEach((header, i) => { if (header) extraFields[header] = rawValues[i]; });

    rows.push({
      master_key: masterKey,
      project: project || null,
      vendor_code: vendorCode || null,
      main_pic_email: cell(row, cols.pic) || null,
      company_name: company || null,
      part_name: partName || null,
      part_no: partNo || null,
      part_no_norm: normalizePartNo(partNo),
      submission_plan: parseExcelDate(cols.submissionPlan ? row.getCell(cols.submissionPlan).value : null),
      imds_status: cell(row, cols.imdsStatus) || null,
      imds_id_version: cell(row, cols.imdsIdVersion) || null,
      part_status: cell(row, cols.partStatus) || null,
      have_respond_email: cell(row, cols.haveRespondEmail) || null,
      status_update: cell(row, cols.statusUpdate) || null,
      md_id_version: cell(row, cols.mdIdVersion) || null,
      md_status_update_date: parseExcelDate(cols.mdStatusDate ? row.getCell(cols.mdStatusDate).value : null),
      comment: cell(row, cols.comment) || null,
      lpop_confirmation: cell(row, cols.lpop) || null,
      cek: cell(row, cols.cek) || null,
      extra_fields: extraFields,
      source_file_name: file.name,
      source_file_hash: fileHash,
      source_sheet: sheet.name,
      source_row: rowNo,
      last_imported_at: new Date().toISOString(),
      updated_by: ctx.user.id
    });
  }
  if (!rows.length) return NextResponse.json({ error: "No usable part rows were found beneath the detected header row." }, { status: 422 });

  const existing = new Map<string, Record<string, unknown>>();
  const keys = rows.map((row) => String(row.master_key));
  for (let i = 0; i < keys.length; i += 300) {
    const { data, error } = await ctx.supabase.from("imds_master_parts")
      .select("id,master_key,manual_overrides,md_system_records,md_system_updated_at,md_id_version,md_status_update_date,supplier_promise_date,supplier_promise_updated_at,created_at")
      .in("master_key", keys.slice(i, i + 300));
    if (error) return NextResponse.json({ error: `Could not compare the workbook with the current master: ${error.message}` }, { status: 500 });
    for (const record of data || []) existing.set(record.master_key, record as Record<string, unknown>);
  }

  let insertedRows = 0, updatedRows = 0, skippedRows = 0;
  const manualKeys = ["project","vendor_code","main_pic_email","company_name","part_name","part_no","submission_plan","imds_status","imds_id_version","part_status","have_respond_email","status_update","md_id_version","md_status_update_date","comment","lpop_confirmation","cek"];
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK).map((incoming) => {
      const old = existing.get(String(incoming.master_key));
      if (!old) { insertedRows++; return incoming; }
      updatedRows++;
      const overrides = Array.isArray(old.manual_overrides) ? old.manual_overrides.map(String) : [];
      const merged: Record<string, unknown> = {
        ...incoming,
        id: old.id,
        created_at: old.created_at,
        manual_overrides: overrides,
        md_system_records: old.md_system_records ?? [],
        md_system_updated_at: old.md_system_updated_at ?? null,
        supplier_promise_date: old.supplier_promise_date ?? null,
        supplier_promise_updated_at: old.supplier_promise_updated_at ?? null
      };
      for (const field of manualKeys) {
        if (overrides.includes(field)) merged[field] = old[field] ?? null;
      }
      if (overrides.length) skippedRows += overrides.length;
      return merged;
    });
    const { error } = await ctx.supabase.from("imds_master_parts").upsert(chunk, { onConflict: "master_key" });
    if (error) return NextResponse.json({ error: `Master update failed at row ${i + 1}: ${error.message}` }, { status: 500 });
  }

  // Import the workbook's Contact NOT SUBMITTED YET directory into the supplier PIC table.
  let contactsUpserted = 0;
  const contactSheet = workbook.worksheets.find((ws) => ws.name.trim().toLowerCase() === "contact not submitted yet");
  if (contactSheet) {
    const contactHeader = findHeaderRow(contactSheet, [["COMPANY NAME"], ["EMAIL PIC"]], 10);
    const contactRows: Array<Record<string, unknown>> = [];
    const seen = new Set<string>();
    const cc = (contactSheet.getRow(contactHeader).values as unknown[]).map((v) => cleanCell(v).toLowerCase());
    const findContactCol = (names: string[], fallback: number) => {
      const index = cc.findIndex((v) => names.map((n) => n.toLowerCase()).includes(v));
      return index >= 0 ? index : fallback;
    };
    // This source workbook uses B=vendor, C=company, D=PIC, F=CC, G=SPV.
    const vendorCol = 2, companyCol = 3, picCol = 4, ccCol = 6, spvCol = 7;
    for (let rowNo = contactHeader + 1; rowNo <= contactSheet.rowCount; rowNo++) {
      const row = contactSheet.getRow(rowNo);
      const supplierCode = cell(row, vendorCol);
      const supplierName = cell(row, companyCol);
      if (!supplierCode || !supplierName) continue;
      for (const [role, value] of [["PIC", cell(row, picCol)], ["CC", cell(row, ccCol)], ["SPV", cell(row, spvCol)]] as const) {
        for (const email of uniqueEmails(value)) {
          const key = `${supplierCode.toUpperCase()}|${email.toLowerCase()}`;
          if (seen.has(key)) continue;
          seen.add(key);
          contactRows.push({ supplier_code: supplierCode, supplier_name: supplierName, contact_name: null, email, contact_role: role, active: true, created_by: ctx.user.id });
        }
      }
    }
    for (let i = 0; i < contactRows.length; i += CHUNK) {
      const { data, error } = await ctx.supabase.from("supplier_contacts")
        .upsert(contactRows.slice(i, i + CHUNK), { onConflict: "supplier_code,email" })
        .select("id");
      if (error) return NextResponse.json({ error: `Master rows were imported, but supplier contacts could not be updated: ${error.message}`, imported: rows.length }, { status: 500 });
      contactsUpserted += data?.length || 0;
    }
  }

  const { data: batch, error: batchError } = await ctx.supabase.from("imds_master_import_batches").insert({
    file_name: file.name, source_file_hash: fileHash, source_sheet: sheet.name,
    total_rows: rows.length, inserted_rows: insertedRows, updated_rows: updatedRows, skipped_rows: skippedRows,
    uploaded_by: ctx.user.id,
    metadata: { headerRow, contactSheet: Boolean(contactSheet), contactsUpserted, sourceColumns: headers.length }
  }).select("id,created_at").single();
  if (batchError) return NextResponse.json({ error: `Master data was imported, but import history could not be written: ${batchError.message}`, imported: rows.length }, { status: 500 });

  await ctx.supabase.from("audit_events").insert({
    actor_id: ctx.user.id, action: "IMDS_MASTER_IMPORTED", entity_type: "imds_master_import", entity_id: batch.id,
    metadata: { fileName: file.name, rows: rows.length, insertedRows, updatedRows, contactsUpserted, fileHash }
  });
  return NextResponse.json({
    batchId: batch.id, fileName: file.name, sheet: sheet.name, totalRows: rows.length,
    insertedRows, updatedRows, skippedRows, contactsUpserted,
    warnings: [`${skippedRows} manually overridden field values were preserved.`, "Rows omitted from a later workbook are retained in the master; imports never delete records automatically."]
  }, { headers: { "Cache-Control": "no-store" } });
}
