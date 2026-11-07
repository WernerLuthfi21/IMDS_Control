import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { getAuthContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { enqueuePartMasterRows, dispatchPartMasterOutbox } from "@/lib/imds-master/outbox";

export const runtime = "nodejs";
export const maxDuration = 60;

type MasterCandidate = {
  id: string;
  master_key: string;
  part_no_norm: string | null;
  vendor_code: string | null;
  company_name: string | null;
  md_system_records: unknown;
  manual_overrides: string[] | null;
  status_update: string | null;
  md_id_version: string | null;
  md_status_update_date: string | null;
  comment: string | null;
};

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
  return v === null ? "" : String(v).replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function normHeader(value: unknown) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizePartNo(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizeCompany(value: unknown) {
  return text(value).toUpperCase()
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\b(PT|TBK|CORPORATION|CORP|CO|LTD|LIMITED|INDONESIA)\b/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function companyScore(source: string, target: string): number {
  const a = new Set(normalizeCompany(source).split(" ").filter((x) => x.length > 2));
  const b = new Set(normalizeCompany(target).split(" ").filter((x) => x.length > 2));
  if (!a.size || !b.size) return 0;
  const common = [...a].filter((x) => b.has(x)).length;
  return common / new Set([...a, ...b]).size;
}

function vendorTokens(value: unknown, isMdCode = false): Set<string> {
  const result = new Set<string>();
  const raw = text(value).toUpperCase();
  if (!raw) return result;
  const initial = isMdCode ? [raw, raw.replace(/^Z008/, "")] : [raw];
  for (const item of initial) {
    for (const group of item.split(/[\n,;|/]+/)) {
      for (const token of group.trim().split(/[\s-]+/).filter(Boolean)) {
        const clean = token.replace(/[^A-Z0-9]/g, "");
        if (!clean) continue;
        result.add(clean);
        if (/^Z008/.test(clean) && clean.length > 4) result.add(clean.slice(4));
        const digits = clean.replace(/\D/g, "");
        if (digits.length >= 4) result.add(digits.slice(-4));
      }
    }
  }
  return result;
}

function sameSupplierGroup(a: MasterCandidate, b: MasterCandidate) {
  return normalizeCompany(a.company_name) === normalizeCompany(b.company_name)
    && [...vendorTokens(a.vendor_code)].some((token) => vendorTokens(b.vendor_code).has(token));
}

function chooseCandidates(
  candidates: MasterCandidate[],
  mdSupplierCode: string,
  fromCompany: string
): { matches: MasterCandidate[]; reason: string; status: "MATCHED" | "AMBIGUOUS" | "UNMATCHED" } {
  if (!candidates.length) {
    return { matches: [], reason: "Part number was not found in the current master.", status: "UNMATCHED" };
  }

  const mdTokens = vendorTokens(mdSupplierCode, true);
  const codeMatches = mdTokens.size
    ? candidates.filter((candidate) => [...vendorTokens(candidate.vendor_code)].some((token) => mdTokens.has(token)))
    : [];

  if (codeMatches.length) {
    const groups: MasterCandidate[][] = [];
    for (const candidate of codeMatches) {
      const group = groups.find((items) => sameSupplierGroup(items[0], candidate));
      if (group) group.push(candidate);
      else groups.push([candidate]);
    }
    if (groups.length === 1) {
      return { matches: groups[0], reason: "Exact part number + supplier/vendor code (including vendor-code prefix normalization).", status: "MATCHED" };
    }
    const ranked = groups.map((group) => ({
      group,
      score: companyScore(fromCompany, group[0].company_name || "")
    })).sort((a, b) => b.score - a.score);
    if (ranked[0]?.score >= 0.25 && (!ranked[1] || ranked[0].score - ranked[1].score >= 0.15)) {
      return { matches: ranked[0].group, reason: "Exact part number + supplier code + company-name confirmation.", status: "MATCHED" };
    }
    return { matches: [], reason: "Supplier code resolves to multiple master supplier groups; automatic update was blocked.", status: "AMBIGUOUS" };
  }

  if (!fromCompany) {
    return { matches: [], reason: "Part number exists, but MD supplier code did not match and company name was not provided.", status: "AMBIGUOUS" };
  }

  const groups: MasterCandidate[][] = [];
  for (const candidate of candidates) {
    const group = groups.find((items) => sameSupplierGroup(items[0], candidate));
    if (group) group.push(candidate);
    else groups.push([candidate]);
  }
  const ranked = groups.map((group) => ({
    group,
    score: companyScore(fromCompany, group[0].company_name || "")
  })).sort((a, b) => b.score - a.score);

  if (ranked[0]?.score >= 0.30 && (!ranked[1] || ranked[0].score - ranked[1].score >= 0.15)) {
    return { matches: ranked[0].group, reason: "Exact part number + unambiguous company-name match.", status: "MATCHED" };
  }
  return { matches: [], reason: "Part number exists for one or more suppliers, but the supplier identity could not be confirmed safely.", status: "AMBIGUOUS" };
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

function dateISO(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const v = plain(value);
  if (typeof v === "number" && v > 20000 && v < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000).toISOString().slice(0, 10);
  }
  if (typeof v === "string") {
    const s = v.trim();
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    m = /^(\d{1,2})[/. -](\d{1,2})[/. -](\d{4})$/.exec(s);
    if (m) {
      const day = Number(m[1]), month = Number(m[2]), year = Number(m[3]);
      if (day > 12) return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (month > 12) return `${year}-${String(day).padStart(2, "0")}-${String(month).padStart(2, "0")}`;
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  return null;
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
    if (!cols.partNo || !cols.idVersion) {
      return NextResponse.json({ error: "Required MD System columns (Part/Item No. and ID / Version) were not detected." }, { status: 422 });
    }

    const parsed: Array<{ rowNo: number; partNo: string; partNoNorm: string; supplierCode: string; fromCompany: string; record: Record<string, unknown> }> = [];
    const maxRow = Math.min(sheet.rowCount, headerRow + 100000);
    let skipped = 0;

    for (let rowNo = headerRow + 1; rowNo <= maxRow; rowNo++) {
      const row = sheet.getRow(rowNo);
      const values = Array.from({ length: headers.length }, (_, i) => plain(row.getCell(i + 1).value));
      if (values.every((v) => v === null || v === "")) continue;
      const getText = (col: number) => col ? text(row.getCell(col).value) || null : null;
      const getDate = (col: number) => col ? dateISO(row.getCell(col).value) : null;
      const partNo = getText(cols.partNo);
      if (!partNo) { skipped++; continue; }
      const supplierCode = String(getText(cols.supplierCode) || "");
      const fromCompany = String(getText(cols.fromCompany) || "");
      const raw: Record<string, unknown> = {};
      headers.forEach((header, i) => { raw[`${header || "Column"} [col ${i + 1}]`] = values[i]; });

      const record: Record<string, unknown> = {
        type: getText(cols.type),
        name: getText(cols.name),
        partNo,
        idVersion: getText(cols.idVersion),
        status: getText(cols.status),
        reasonForDenial: getText(cols.reason),
        lastStatusChanged: getDate(cols.changed),
        fromCompany,
        mdSupplierCode: supplierCode,
        legacySparePart: getText(cols.legacySparePart),
        legacyStatus: getText(cols.legacyStatus),
        legacyLastStatusChanged: getDate(cols.legacyChanged),
        followUpDate: getDate(cols.followUpDate),
        legacyReasonForDenial: getText(cols.legacyReason),
        sourceRow: rowNo,
        sourceFile: file.name,
        raw
      };
      parsed.push({ rowNo, partNo, partNoNorm: normalizePartNo(partNo), supplierCode, fromCompany, record });
    }

    if (!parsed.length) return NextResponse.json({ error: "No usable MD System result rows were found." }, { status: 422 });

    const partNumbers = [...new Set(parsed.map((item) => item.partNoNorm))];
    const byPartNo = new Map<string, MasterCandidate[]>();
    for (let index = 0; index < partNumbers.length; index += 300) {
      const { data, error } = await supabase.from("imds_master_parts")
        .select("id,master_key,part_no_norm,vendor_code,company_name,md_system_records,manual_overrides,status_update,md_id_version,md_status_update_date,comment")
        .in("part_no_norm", partNumbers.slice(index, index + 300));
      if (error) return NextResponse.json({ error: `Could not match against the shared master: ${error.message}` }, { status: 500 });
      for (const candidate of (data || []) as MasterCandidate[]) {
        const key = candidate.part_no_norm || "";
        const list = byPartNo.get(key) || [];
        list.push(candidate);
        byPartNo.set(key, list);
      }
    }

    const importTime = new Date().toISOString();
    const searchRows: Record<string, unknown>[] = [];
    const updates = new Map<string, { candidate: MasterCandidate; records: Record<string, unknown>[]; patch: Record<string, unknown> }>();
    let matchedSourceRows = 0;
    let ambiguousRows = 0;
    let unmatchedRows = 0;
    const unmatchedSamples: Array<Record<string, unknown>> = [];

    for (const item of parsed) {
      const candidates = byPartNo.get(item.partNoNorm) || [];
      const chosen = chooseCandidates(candidates, item.supplierCode, item.fromCompany);
      const matchStatus = chosen.status;
      if (matchStatus === "MATCHED") {
        matchedSourceRows++;
        for (const candidate of chosen.matches) {
          const existing = updates.get(candidate.id);
          const priorRecords = existing ? existing.records : (Array.isArray(candidate.md_system_records) ? candidate.md_system_records as Record<string, unknown>[] : []);
          const record = {
            ...item.record,
            importedAt: importTime,
            importSource: file.name,
            matchStatus: "MATCHED",
            matchReason: chosen.reason,
            matchedMasterKey: candidate.master_key
          };
          const nextRecords = [
            record,
            ...priorRecords.filter((old) => !(normalizePartNo(String(old.partNo || "")) === item.partNoNorm
              && String(old.mdSupplierCode || "").toUpperCase() === item.supplierCode.toUpperCase()))
          ].slice(0, 20);
          const overrides = new Set((candidate.manual_overrides || []).map(String));
          const patch: Record<string, unknown> = {
            md_system_records: nextRecords,
            md_system_updated_at: importTime,
            updated_by: auth.userId
          };
          if (!overrides.has("status_update")) patch.status_update = item.record.status || null;
          if (!overrides.has("md_id_version")) patch.md_id_version = item.record.idVersion || null;
          if (!overrides.has("md_status_update_date")) patch.md_status_update_date = item.record.lastStatusChanged || null;
          if (!overrides.has("comment")) patch.comment = item.record.reasonForDenial || null;
          updates.set(candidate.id, { candidate, records: nextRecords, patch });
        }
      } else if (matchStatus === "AMBIGUOUS") {
        ambiguousRows++;
        if (unmatchedSamples.length < 30) unmatchedSamples.push({
          partNo: item.partNo, supplierCode: item.supplierCode, fromCompany: item.fromCompany,
          matchStatus, reason: chosen.reason, candidateCount: candidates.length
        });
      } else {
        unmatchedRows++;
        if (unmatchedSamples.length < 30) unmatchedSamples.push({
          partNo: item.partNo, supplierCode: item.supplierCode, fromCompany: item.fromCompany,
          matchStatus, reason: chosen.reason, candidateCount: candidates.length
        });
      }

      searchRows.push({
        part_no: item.partNo,
        part_no_norm: item.partNoNorm,
        md_supplier_code: item.supplierCode || null,
        from_company: item.fromCompany || null,
        result_data: {
          ...item.record,
          matchStatus,
          matchReason: chosen.reason,
          matchedMasterKeys: chosen.matches.map((candidate) => candidate.master_key),
          candidateCount: candidates.length
        }
      });
    }

    const matchedMasterRows = updates.size;
    const { data: batch, error: batchError } = await supabase.from("imds_mds_import_batches").insert({
      file_name: file.name,
      source_file_hash: fileHash,
      source_sheet: sheet.name,
      total_rows: parsed.length,
      matched_master_rows: matchedMasterRows,
      unmatched_part_numbers: unmatchedRows + ambiguousRows,
      uploaded_by: auth.userId,
      metadata: {
        headerRow,
        headerCount: headers.length,
        columns: cols,
        skippedRows: skipped,
        matchedSourceRows,
        ambiguousRows,
        unmatchedRows,
        unmatchedSamples
      }
    }).select("id").single();
    if (batchError || !batch) {
      return NextResponse.json({ error: batchError?.message || "Could not save MD System import history." }, { status: 500 });
    }

    for (let index = 0; index < searchRows.length; index += 400) {
      const chunk = searchRows.slice(index, index + 400).map((row) => ({ ...row, batch_id: batch.id }));
      const { error } = await supabase.from("imds_mds_search_results").insert(chunk);
      if (error) {
        return NextResponse.json({ error: `MD System import history failed at source row ${index + 1}: ${error.message}`, batchId: batch.id }, { status: 500 });
      }
    }

    for (const item of updates.values()) {
      const { error } = await supabase.from("imds_master_parts").update(item.patch).eq("id", item.candidate.id);
      if (error) {
        return NextResponse.json({ error: `MD System history was saved, but master update failed for ${item.candidate.master_key}: ${error.message}`, batchId: batch.id }, { status: 500 });
      }
    }

    let powerAutomate = { configured: false, sent: 0, failed: 0, pending: 0, error: "No matched master rows to sync." as string | undefined };
    if (updates.size) {
      const ids = [...updates.keys()];
      const changedRows: MasterRecord[] = [];
      for (let index = 0; index < ids.length; index += 300) {
        const { data, error } = await supabase.from("imds_master_parts").select("*").in("id", ids.slice(index, index + 300));
        if (error) return NextResponse.json({ error: `Master records updated, but could not read them for Excel sync: ${error.message}`, batchId: batch.id }, { status: 500 });
        changedRows.push(...(data || []) as MasterRecord[]);
      }
      await enqueuePartMasterRows(supabase, auth.userId, changedRows, "md_system_search_import");
      powerAutomate = await dispatchPartMasterOutbox(supabase, 50);
    }

    await supabase.from("audit_events").insert({
      actor_id: auth.userId,
      action: "IMDS_MD_SYSTEM_SEARCH_IMPORTED",
      entity_type: "imds_mds_import_batch",
      entity_id: batch.id,
      metadata: {
        fileName: file.name, totalRows: parsed.length, matchedSourceRows, matchedMasterRows,
        ambiguousRows, unmatchedRows, skippedRows: skipped, powerAutomate
      }
    });

    return NextResponse.json({
      success: true,
      batchId: batch.id,
      fileName: file.name,
      sheetName: sheet.name,
      headerRow,
      totalRows: parsed.length,
      matchedSourceRows,
      matchedMasterRows,
      ambiguousRows,
      unmatchedRows,
      skippedRows: skipped,
      unmatchedSamples,
      powerAutomate,
      note: "Only matched supplier + part-number records were updated. Ambiguous and unmatched results were preserved in import history for review; IMDS Remaining fields were not overwritten."
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("IMDS MD System search import failed.", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "MD System import failed." }, { status: 422 });
  }
}
