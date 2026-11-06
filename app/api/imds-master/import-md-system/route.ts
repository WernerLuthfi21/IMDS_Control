import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { getAuthContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

function plain(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if ("result" in v) return plain(v.result);
    if ("text" in v && typeof v.text === "string") return v.text;
    if ("richText" in v && Array.isArray(v.richText)) {
      return v.richText.map((x) => x && typeof x === "object" && "text" in x ? String((x as { text: unknown }).text) : "").join("");
    }
    if ("hyperlink" in v) return String(v.text || v.hyperlink);
    return JSON.stringify(value);
  }
  return String(value);
}

function text(value: unknown) {
  const v = plain(value);
  return v === null ? "" : String(v).replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim();
}

function normHeader(value: unknown) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizePartNo(value: string) {
  return value.toUpperCase().replace(/\s+/g, "");
}

function dateISO(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const v = plain(value);
  if (typeof v === "number" && v > 20000 && v < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10);
  }
  if (typeof v === "string") {
    const s = v.trim();
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    m = /^(\d{1,2})[\/. -](\d{1,2})[\/. -](\d{4})$/.exec(s);
    if (m) {
      const month = Number(m[1]), day = Number(m[2]), year = Number(m[3]);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      }
    }
  }
  return null;
}

function findAll(headers: string[], fragment: string) {
  const target = normHeader(fragment);
  return headers.flatMap((header, index) => normHeader(header).includes(target) ? [index + 1] : []);
}
function findOne(headers: string[], aliases: string[]) {
  const targets = aliases.map(normHeader);
  const i = headers.findIndex((header) => {
    const current = normHeader(header);
    return targets.some((target) => current === target || (target.length > 8 && current.includes(target)));
  });
  return i < 0 ? 0 : i + 1;
}

export async function POST(request: NextRequest) {
  const auth = await getAuthContext();
  if (!auth.configured) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  if (!auth.userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!["admin", "preparer", "reviewer"].includes(auth.role || "")) {
    return NextResponse.json({ error: "Admin, preparer or reviewer role is required to import MD System results." }, { status: 403 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose an MD System search-result .xlsx file first." }, { status: 400 });
  if (!file.name.toLowerCase().endsWith(".xlsx")) return NextResponse.json({ error: "Only .xlsx workbooks are supported." }, { status: 415 });
  if (file.size > 20 * 1024 * 1024) return NextResponse.json({ error: "File exceeds the 20 MB upload limit." }, { status: 413 });

  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const fileHash = createHash("sha256").update(buffer).digest("hex");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);

    let sheet = workbook.getWorksheet("Export");
    if (!sheet) {
      sheet = workbook.worksheets.find((ws) => {
        for (let r = 1; r <= Math.min(ws.rowCount, 15); r++) {
          const hs = Array.from({ length: Math.min(ws.getRow(r).cellCount, 100) }, (_, i) => normHeader(ws.getRow(r).getCell(i + 1).value));
          if (hs.some((h) => h.includes("partitemno") || h.includes("materialno"))) return true;
        }
        return false;
      });
    }
    if (!sheet) return NextResponse.json({ error: "Could not find an MD System Export sheet or a Part/Item No. header." }, { status: 422 });

    let headerRow = 0;
    for (let r = 1; r <= Math.min(sheet.rowCount, 15); r++) {
      const hs = Array.from({ length: Math.min(sheet.getRow(r).cellCount, 100) }, (_, i) => normHeader(sheet!.getRow(r).getCell(i + 1).value));
      if (hs.some((h) => h.includes("partitemno") || h.includes("materialno"))) { headerRow = r; break; }
    }
    if (!headerRow) return NextResponse.json({ error: "Could not identify the MD System header row." }, { status: 422 });

    const headers = Array.from({ length: Math.min(sheet.columnCount, 200) }, (_, i) => text(sheet!.getRow(headerRow).getCell(i + 1).value));
    const statusCols = findAll(headers, "Status");
    const changedCols = findAll(headers, "last status changed");
    const reasonCols = findAll(headers, "Reason for denial");
    const cols = {
      type: findOne(headers, ["Type"]),
      name: findOne(headers, ["Name"]),
      partNo: findOne(headers, ["Part/Item No., Item- /Mat.-No., Material No.", "Part/Item No.", "Material No."]),
      idVersion: findOne(headers, ["ID / Version", "ID/Version"]),
      status: statusCols[0] || 0,
      reason: reasonCols[0] || 0,
      changed: changedCols[0] || 0,
      fromCompany: findOne(headers, ["from comp. (Org Unit) [ID-No.]", "from comp.", "Org Unit"]),
      supplierCode: findOne(headers, ["Supplier Code"]),
      legacySparePart: findOne(headers, ["Legacy Spare Part"]),
      legacyStatus: statusCols[1] || 0,
      legacyChanged: changedCols[1] || 0,
      followUpDate: findOne(headers, ["Follow Up Date"]),
      legacyReason: reasonCols[1] || 0
    };
    if (!cols.partNo || !cols.idVersion) return NextResponse.json({ error: "Required MD System columns (Part/Item No. and ID / Version) were not detected." }, { status: 422 });

    const grouped = new Map<string, Array<Record<string, unknown>>>();
    const searchRows: Record<string, unknown>[] = [];
    const maxRow = Math.min(sheet.rowCount, headerRow + 100000);
    let skipped = 0;

    for (let r = headerRow + 1; r <= maxRow; r++) {
      const row = sheet.getRow(r);
      const values = Array.from({ length: headers.length }, (_, i) => plain(row.getCell(i + 1).value));
      if (values.every((v) => v === null || v === "")) continue;
      const partNo = text(row.getCell(cols.partNo).value);
      if (!partNo) { skipped++; continue; }
      const partNoNorm = normalizePartNo(partNo);
      const getText = (col: number) => col ? text(row.getCell(col).value) || null : null;
      const getDate = (col: number) => col ? dateISO(row.getCell(col).value) : null;
      const raw: Record<string, unknown> = {};
      headers.forEach((header, i) => { raw[`${header || "Column"} [col ${i + 1}]`] = values[i]; });

      const result: Record<string, unknown> = {
        type: getText(cols.type),
        name: getText(cols.name),
        partNo,
        idVersion: getText(cols.idVersion),
        status: getText(cols.status),
        reasonForDenial: getText(cols.reason),
        lastStatusChanged: getDate(cols.changed),
        fromCompany: getText(cols.fromCompany),
        mdSupplierCode: getText(cols.supplierCode),
        legacySparePart: getText(cols.legacySparePart),
        legacyStatus: getText(cols.legacyStatus),
        legacyLastStatusChanged: getDate(cols.legacyChanged),
        followUpDate: getDate(cols.followUpDate),
        legacyReasonForDenial: getText(cols.legacyReason),
        sourceRow: r,
        raw
      };

      const group = grouped.get(partNoNorm) || [];
      group.push(result);
      grouped.set(partNoNorm, group);
      searchRows.push({
        part_no: partNo,
        part_no_norm: partNoNorm,
        md_supplier_code: getText(cols.supplierCode),
        from_company: getText(cols.fromCompany),
        result_data: result
      });
    }

    if (!searchRows.length) return NextResponse.json({ error: "No usable MD System result rows were found." }, { status: 422 });

    const uniquePartNos = [...grouped.keys()];
    const masterByPartNo = new Map<string, string[]>();
    for (let i = 0; i < uniquePartNos.length; i += 300) {
      const chunk = uniquePartNos.slice(i, i + 300);
      const { data, error } = await supabase.from("imds_master_parts").select("id,part_no_norm").in("part_no_norm", chunk);
      if (error) return NextResponse.json({ error: `Could not match MD System rows to the current master: ${error.message}` }, { status: 500 });
      for (const row of data || []) {
        const key = String(row.part_no_norm);
        const ids = masterByPartNo.get(key) || [];
        ids.push(String(row.id));
        masterByPartNo.set(key, ids);
      }
    }

    const matchedMasterRows = [...masterByPartNo.values()].reduce((sum, ids) => sum + ids.length, 0);
    const unmatchedPartNumbers = uniquePartNos.filter((partNo) => !masterByPartNo.has(partNo)).length;
    const { data: batch, error: batchError } = await supabase.from("imds_mds_import_batches").insert({
      file_name: file.name,
      source_file_hash: fileHash,
      source_sheet: sheet.name,
      total_rows: searchRows.length,
      matched_master_rows: matchedMasterRows,
      unmatched_part_numbers: unmatchedPartNumbers,
      uploaded_by: auth.userId,
      metadata: { headerRow, headerCount: headers.length, columns: cols, skippedRows: skipped }
    }).select("id").single();
    if (batchError || !batch) return NextResponse.json({ error: batchError?.message || "Could not create MD System import batch." }, { status: 500 });

    for (let i = 0; i < searchRows.length; i += 400) {
      const chunk = searchRows.slice(i, i + 400).map((row) => ({ ...row, batch_id: batch.id }));
      const { error } = await supabase.from("imds_mds_search_results").insert(chunk);
      if (error) return NextResponse.json({ error: `MD System history insert failed at row ${i + 1}: ${error.message}` }, { status: 500 });
    }

    const now = new Date().toISOString();
    let updatedRows = 0;
    for (const [partNoNorm, ids] of masterByPartNo) {
      const records = grouped.get(partNoNorm) || [];
      for (const id of ids) {
        const { error } = await supabase.from("imds_master_parts")
          .update({ md_system_records: records, md_system_updated_at: now, updated_by: auth.userId })
          .eq("id", id);
        if (error) return NextResponse.json({ error: `MD System data was staged, but a matched master row could not be updated: ${error.message}` }, { status: 500 });
        updatedRows++;
      }
    }

    await supabase.from("audit_events").insert({
      actor_id: auth.userId,
      action: "IMDS_MD_SYSTEM_SEARCH_IMPORTED",
      entity_type: "imds_mds_import_batch",
      entity_id: batch.id,
      metadata: { fileName: file.name, sourceRows: searchRows.length, matchedMasterRows: updatedRows, unmatchedPartNumbers, skipped }
    });

    return NextResponse.json({
      success: true,
      batchId: batch.id,
      fileName: file.name,
      sheetName: sheet.name,
      headerRow,
      totalRows: searchRows.length,
      matchedMasterRows: updatedRows,
      unmatchedPartNumbers,
      skipped,
      note: "Only the MD System result fields were updated. Part List vendor codes, PICs, plans, comments and manual judgement/status fields were not overwritten."
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("MD System result import failed.", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "MD System import failed." }, { status: 422 });
  }
}
