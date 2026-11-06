import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { trackerAuth } from "@/lib/imds-tracker/auth";
import { cleanCell, findHeaderRow, normalizePartNo, normalizeWords, parseExcelDate, plainCell, vendorDigits } from "@/lib/imds-tracker/utils";
import { pushTrackerToPowerAutomate } from "@/lib/imds-tracker/bridge";

export const runtime = "nodejs";
export const maxDuration = 60;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const CHUNK = 150;

type MasterCandidate = {
  id: string; master_key: string; vendor_code: string | null; company_name: string | null;
  md_system_records: unknown; md_id_version: string | null; md_status_update_date: string | null;
  manual_overrides: string[] | null;
};

function findColumn(headers: string[], includes: string[], occurrence = 0): number {
  const matches = headers.map((h, i) => ({ h: h.toLowerCase().replace(/\s+/g, " ").trim(), i }))
    .filter(({ h }) => includes.some((p) => h.includes(p.toLowerCase())));
  return matches[occurrence]?.i ?? -1;
}
function value(row: ExcelJS.Row, index: number): string {
  return index < 0 ? "" : cleanCell(row.getCell(index + 1).value);
}
function companyScore(source: string, target: string): number {
  const a = new Set(normalizeWords(source).split(" ").filter((x) => x.length > 2));
  const b = new Set(normalizeWords(target).split(" ").filter((x) => x.length > 2));
  if (!a.size || !b.size) return 0;
  const common = [...a].filter((x) => b.has(x)).length;
  return common / new Set([...a, ...b]).size;
}
function resolveMatch(candidates: MasterCandidate[], mdCode: string, fromCompany: string) {
  if (candidates.length === 1) return { match: candidates[0], reason: "exact part number" };
  const code = vendorDigits(mdCode);
  const byCode = code ? candidates.filter((c) => vendorDigits(c.vendor_code) === code) : [];
  if (byCode.length === 1) return { match: byCode[0], reason: "part number + supplier code" };
  const pool = byCode.length ? byCode : candidates;
  const ranked = pool.map((candidate) => ({ candidate, score: companyScore(fromCompany, candidate.company_name || "") }))
    .sort((a, b) => b.score - a.score);
  if (ranked[0]?.score >= 0.25 && (!ranked[1] || ranked[0].score - ranked[1].score >= 0.12)) {
    return { match: ranked[0].candidate, reason: "part number + company name" };
  }
  return { match: null, reason: "multiple master rows share this part number; supplier could not be resolved safely" };
}

export async function POST(request: NextRequest) {
  const ctx = await trackerAuth(["admin", "preparer", "reviewer"]);
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose an MD System SearchResult .xlsx file first." }, { status: 400 });
  if (!file.name.toLowerCase().endsWith(".xlsx")) return NextResponse.json({ error: "Only .xlsx workbooks are accepted." }, { status: 415 });
  if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "Workbook exceeds 20 MB." }, { status: 413 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const fileHash = createHash("sha256").update(buffer).digest("hex");
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Workbook could not be read." }, { status: 422 }); }
  const sheet = workbook.getWorksheet("Export") || workbook.worksheets.find((ws) => findHeaderRow(ws, [["Type"], ["Name"], ["Part/Item No", "Material No"]], 20) > 0);
  if (!sheet) return NextResponse.json({ error: "Could not find an Export sheet or MD System result headers." }, { status: 422 });
  const headerRow = findHeaderRow(sheet, [["Type"], ["Name"], ["Part/Item No", "Material No"]], 20);
  if (!headerRow) return NextResponse.json({ error: "Could not identify the MD System header row." }, { status: 422 });
  const headers = (sheet.getRow(headerRow).values as unknown[]).slice(1).map((v) => cleanCell(v));
  const cols = {
    type: findColumn(headers, ["type"]), name: findColumn(headers, ["name"]),
    partNo: findColumn(headers, ["part/item no", "material no"]),
    idVersion: findColumn(headers, ["id / version"]),
    status: findColumn(headers, ["status"], 0),
    reason: findColumn(headers, ["reason for denial"], 0),
    lastChanged: findColumn(headers, ["last status changed"], 0),
    fromCompany: findColumn(headers, ["from comp", "org unit"]),
    supplierCode: findColumn(headers, ["supplier code"]),
    legacy: findColumn(headers, ["legacy spare part"]),
    secondaryStatus: findColumn(headers, ["status"], 1),
    secondaryChanged: findColumn(headers, ["last status changed"], 1),
    followUpDate: findColumn(headers, ["follow up date"]),
    secondaryReason: findColumn(headers, ["reason for denial"], 1)
  };
  if (cols.partNo < 0 || cols.status < 0 || cols.supplierCode < 0) return NextResponse.json({ error: "Required MD System columns Part/Item No., Status and Supplier Code were not found." }, { status: 422 });

  const parsed: Array<{ rowNo: number; partNo: string; partNoNorm: string; supplierCode: string; fromCompany: string; record: Record<string, unknown> }> = [];
  for (let rowNo = headerRow + 1; rowNo <= Math.min(sheet.rowCount, headerRow + 50000); rowNo++) {
    const row = sheet.getRow(rowNo);
    const partNo = value(row, cols.partNo);
    if (!partNo) continue;
    const supplierCode = value(row, cols.supplierCode);
    const fromCompany = value(row, cols.fromCompany);
    const record: Record<string, unknown> = {
      type: value(row, cols.type), name: value(row, cols.name), partNo,
      idVersion: value(row, cols.idVersion), status: value(row, cols.status),
      reasonForDenial: value(row, cols.reason),
      lastStatusChanged: parseExcelDate(cols.lastChanged >= 0 ? row.getCell(cols.lastChanged + 1).value : null),
      fromCompany, supplierCode, legacySparePart: value(row, cols.legacy),
      secondaryStatus: value(row, cols.secondaryStatus),
      secondaryLastStatusChanged: parseExcelDate(cols.secondaryChanged >= 0 ? row.getCell(cols.secondaryChanged + 1).value : null),
      followUpDate: parseExcelDate(cols.followUpDate >= 0 ? row.getCell(cols.followUpDate + 1).value : null),
      secondaryReasonForDenial: value(row, cols.secondaryReason),
      sourceRow: rowNo, sourceFile: file.name
    };
    parsed.push({ rowNo, partNo, partNoNorm: normalizePartNo(partNo), supplierCode, fromCompany, record });
  }
  if (!parsed.length) return NextResponse.json({ error: "No usable part-number rows were found in the search result." }, { status: 422 });

  const byPart = new Map<string, MasterCandidate[]>();
  const partNumbers = [...new Set(parsed.map((r) => r.partNoNorm))];
  for (let i = 0; i < partNumbers.length; i += 300) {
    const { data, error } = await ctx.supabase.from("imds_master_parts")
      .select("id,master_key,vendor_code,company_name,md_system_records,md_id_version,md_status_update_date,manual_overrides")
      .in("part_no_norm", partNumbers.slice(i, i + 300));
    if (error) return NextResponse.json({ error: `Could not read the tracker master: ${error.message}` }, { status: 500 });
    for (const candidate of (data || []) as MasterCandidate[]) {
      const key = (await Promise.resolve(candidate)).master_key; // keep the map key explicit and stable
      const normalized = parsed.find((r) => r.partNoNorm && r.partNoNorm === normalizePartNo(r.partNo) && r.partNoNorm && r.partNoNorm === key) ? key : "";
      void normalized;
      // The normalized part number is fetched from the same master row in a second keyed lookup below.
      const { data: owner } = await ctx.supabase.from("imds_master_parts").select("part_no_norm").eq("id", candidate.id).maybeSingle();
      const partKey = owner?.part_no_norm || "";
      if (!byPart.has(partKey)) byPart.set(partKey, []);
      byPart.get(partKey)!.push(candidate);
    }
  }

  const now = new Date().toISOString();
  const matchedUpdates = new Map<string, { id: string; masterKey: string; patch: Record<string, unknown>; row: Record<string, unknown> }>();
  let matched = 0, unmatched = 0, ambiguous = 0;
  const searchRows: Array<Record<string, unknown>> = [];
  const unmatchedSamples: Array<Record<string, unknown>> = [];

  for (const item of parsed) {
    const candidates = byPart.get(item.partNoNorm) || [];
    let result: { match: MasterCandidate | null; reason: string };
    if (!candidates.length) result = { match: null, reason: "part number not found in the current master" };
    else result = resolveMatch(candidates, item.supplierCode, item.fromCompany);
    const matchStatus = result.match ? "MATCHED" : candidates.length ? "AMBIGUOUS" : "UNMATCHED";
    if (result.match) {
      matched++;
      const old = matchedUpdates.get(result.match.id);
      const prior = old ? old.patch.md_system_records as Record<string, unknown>[] : Array.isArray(result.match.md_system_records) ? result.match.md_system_records as Record<string, unknown>[] : [];
      const record = { ...item.record, importedAt: now, importSource: file.name, matchReason: result.reason };
      const records = [record, ...prior.filter((x) => x.partNo !== item.partNo || x.supplierCode !== item.supplierCode)].slice(0, 12);
      const overrides = result.match.manual_overrides || [];
      const patch: Record<string, unknown> = { md_system_records: records, md_system_updated_at: now, updated_by: ctx.user.id };
      if (!overrides.includes("md_id_version")) patch.md_id_version = item.record.idVersion || null;
      if (!overrides.includes("md_status_update_date")) patch.md_status_update_date = item.record.lastStatusChanged || null;
      matchedUpdates.set(result.match.id, { id: result.match.id, masterKey: result.match.master_key, patch, row: { masterKey: result.match.master_key, partNo: item.partNo, supplierCode: item.supplierCode, mdSystem: record } });
    } else {
      if (matchStatus === "AMBIGUOUS") ambiguous++; else unmatched++;
      if (unmatchedSamples.length < 30) unmatchedSamples.push({ partNo: item.partNo, supplierCode: item.supplierCode, fromCompany: item.fromCompany, matchStatus, reason: result.reason, candidateCount: candidates.length });
    }
    searchRows.push({
      part_no: item.partNo, part_no_norm: item.partNoNorm, md_supplier_code: item.supplierCode || null,
      from_company: item.fromCompany || null,
      result_data: { ...item.record, matchStatus, matchReason: result.reason, matchedMasterKey: result.match?.master_key || null, candidateCount: candidates.length }
    });
  }

  const { data: batch, error: batchError } = await ctx.supabase.from("imds_mds_import_batches").insert({
    file_name: file.name, source_file_hash: fileHash, source_sheet: sheet.name,
    total_rows: parsed.length, matched_master_rows: matchedUpdates.size, unmatched_part_numbers: unmatched + ambiguous,
    uploaded_by: ctx.user.id, metadata: { matchedRows: matched, ambiguousRows: ambiguous, unmatchedRows: unmatched, headerRow, sampleUnmatched: unmatchedSamples }
  }).select("id,created_at").single();
  if (batchError || !batch) return NextResponse.json({ error: batchError?.message || "Failed to save MD System import history." }, { status: 500 });

  for (let i = 0; i < searchRows.length; i += CHUNK) {
    const chunk = searchRows.slice(i, i + CHUNK).map((row) => ({ ...row, batch_id: batch.id }));
    const { error } = await ctx.supabase.from("imds_mds_search_results").insert(chunk);
    if (error) return NextResponse.json({ error: `Search results were parsed but history rows failed to save: ${error.message}`, batchId: batch.id }, { status: 500 });
  }
  const updatedRows = [...matchedUpdates.values()];
  for (let i = 0; i < updatedRows.length; i += CHUNK) {
    const chunk = updatedRows.slice(i, i + CHUNK);
    for (const record of chunk) {
      const { error } = await ctx.supabase.from("imds_master_parts").update(record.patch).eq("id", record.id);
      if (error) return NextResponse.json({ error: `MD System history was saved, but tracker update failed for ${record.masterKey}: ${error.message}`, batchId: batch.id }, { status: 500 });
    }
  }

  const bridge = updatedRows.length ? await pushTrackerToPowerAutomate({
    type: "imds_tracker_bulk_upsert",
    source: "md_system_search_import",
    batchId: batch.id,
    rows: updatedRows.map((r) => ({ masterKey: r.masterKey, partNo: r.row.partNo, supplierCode: r.row.supplierCode, mdSystem: r.row.mdSystem }))
  }) : { configured: false, ok: false, status: 0, error: "No matched rows to push." };

  await ctx.supabase.from("audit_events").insert({
    actor_id: ctx.user.id, action: "IMDS_MDS_SEARCH_IMPORTED", entity_type: "imds_mds_import", entity_id: batch.id,
    metadata: { fileName: file.name, totalRows: parsed.length, matchedRows: matched, ambiguousRows: ambiguous, unmatchedRows: unmatched }
  });
  return NextResponse.json({
    batchId: batch.id, fileName: file.name, sheet: sheet.name, totalRows: parsed.length,
    matchedRows: matched, updatedMasterRows: matchedUpdates.size, unmatchedRows: unmatched,
    ambiguousRows: ambiguous, unmatchedSamples, powerAutomate: bridge
  }, { headers: { "Cache-Control": "no-store" } });
}
