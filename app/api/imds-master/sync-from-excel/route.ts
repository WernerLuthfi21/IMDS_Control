import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

type Cell = string | number | boolean | null | undefined;
type ExcelRow = Record<string, Cell>;

const MAX_ROWS = 5000;
const MAX_BYTES = 3_800_000;
const CHUNK_SIZE = 150;

const FIELD_MAP: Array<{ db: string; headers: string[]; kind?: "date" }> = [
  { db: "project", headers: ["PROJECT", "Project"] },
  { db: "vendor_code", headers: ["VENDOR CODE", "Vendor Code"] },
  { db: "main_pic_email", headers: ["MAIN PIC EMAIL", "Main PIC Email"] },
  { db: "company_name", headers: ["COMPANY NAME", "Company Name"] },
  { db: "part_name", headers: ["PART NAME", "Part Name"] },
  { db: "part_no", headers: ["P/No.", "P/No", "Part No."] },
  { db: "submission_plan", headers: ["SUBMISSION PLAN"], kind: "date" },
  { db: "supplier_promise_date", headers: ["Supplier Promise Date"], kind: "date" },
  { db: "imds_status", headers: ["IMDS STATUS"] },
  { db: "imds_id_version", headers: ["ID / Ver"] },
  { db: "part_status", headers: ["Part Status"] },
  { db: "have_respond_email", headers: ["Have respond email"] },
  { db: "status_update", headers: ["STATUS UPDATE"] },
  { db: "md_id_version", headers: ["ID/Ver", "MD ID/Ver"] },
  { db: "md_status_update_date", headers: ["Date"], kind: "date" },
  { db: "comment", headers: ["Comment"] },
  { db: "lpop_confirmation", headers: ["LPOP Confirmation"] },
  { db: "cek", headers: ["CEK"] }
];

const RESERVED = new Set([
  "No.", "MasterKey", "ItemInternalId", "@odata.etag", ...FIELD_MAP.flatMap((field) => field.headers)
].map((header) => normHeader(header)));

function normHeader(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function readCell(row: ExcelRow, headers: string[]): { found: boolean; value: Cell } {
  for (const header of headers) {
    if (Object.prototype.hasOwnProperty.call(row, header)) return { found: true, value: row[header] };
  }
  const wanted = new Set(headers.map(normHeader));
  const key = Object.keys(row).find((item) => wanted.has(normHeader(item)));
  return key ? { found: true, value: row[key] } : { found: false, value: undefined };
}

function cleanText(value: Cell): string | null {
  if (value === null || value === undefined) return null;
  const result = String(value).replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  if (!result || /^#(N\/A|VALUE!|REF!|NAME\?)/i.test(result)) return null;
  return result;
}

function cleanDate(value: Cell): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && value > 20000 && value < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000).toISOString().slice(0, 10);
  }
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const serial = Number(raw);
  if (/^\d+(\.\d+)?$/.test(raw) && serial > 20000 && serial < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000).toISOString().slice(0, 10);
  }
  const match = /^(\d{1,2})[/. -](\d{1,2})[/. -](\d{4})$/.exec(raw);
  if (match) {
    let day = Number(match[1]), month = Number(match[2]);
    const year = Number(match[3]);
    if (day <= 12 && month > 12) [day, month] = [month, day];
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return null;
}

function normalizePartNo(value: string | null) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function authorized(request: NextRequest): boolean {
  const expected = process.env.POWER_AUTOMATE_SECRET?.trim() || "";
  const supplied = request.headers.get("x-imds-secret") || "";
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

function buildMasterKey(row: ExcelRow, occurrence: Map<string, number>): string {
  const project = cleanText(readCell(row, ["PROJECT"]).value) || "UNASSIGNED";
  const vendor = cleanText(readCell(row, ["VENDOR CODE"]).value) || "NO_VENDOR";
  const company = cleanText(readCell(row, ["COMPANY NAME"]).value) || "NO_COMPANY";
  const partNo = cleanText(readCell(row, ["P/No.", "P/No", "Part No."]).value) || "";
  const sequence = cleanText(readCell(row, ["No."]).value) || "";
  const base = [project, vendor, company, normalizePartNo(partNo), sequence]
    .map((value) => value.toUpperCase().replace(/[|\s]+/g, "_")).join("|");
  const count = occurrence.get(base) || 0;
  occurrence.set(base, count + 1);
  return createHash("sha256").update(`${base}|duplicate:${count}`).digest("hex");
}

function toMasterRow(row: ExcelRow, sourceRow: number, masterKey: string, prior?: Record<string, unknown>) {
  const patch: Record<string, unknown> = {
    master_key: masterKey,
    extra_fields: { ...((prior?.extra_fields || {}) as Record<string, unknown>) },
    md_system_records: prior?.md_system_records ?? [],
    md_system_updated_at: prior?.md_system_updated_at ?? null,
    manual_overrides: Array.isArray(prior?.manual_overrides) ? [...prior.manual_overrides] : [],
    source_file_name: "Power Automate / Shared Master Excel",
    source_sheet: "Part List LATEST",
    source_row: sourceRow,
    last_imported_at: new Date().toISOString(),
    updated_by: prior?.updated_by ?? null
  };

  const overrides = new Set((patch.manual_overrides as string[]).map(String));
  for (const field of FIELD_MAP) {
    const found = readCell(row, field.headers);
    if (!found.found) continue;
    const value = field.kind === "date" ? cleanDate(found.value) : cleanText(found.value);
    const mdFormulaField = ["status_update", "md_id_version", "md_status_update_date", "comment"].includes(field.db);
    if (mdFormulaField && patch.md_system_records && Array.isArray(patch.md_system_records) && patch.md_system_records.length && !value) {
      patch[field.db] = prior?.[field.db] ?? null;
    } else {
      patch[field.db] = value;
    }
    // Excel is the live shared workbook. Its explicit value (including a blank) supersedes a prior website override.
    overrides.delete(field.db);
  }

  const extras = { ...((prior?.extra_fields || {}) as Record<string, unknown>) };
  for (const [header, value] of Object.entries(row)) {
    const normalized = normHeader(header);
    if (!header || RESERVED.has(normalized) || normalized === "masterkey") continue;
    extras[header] = value === undefined ? null : value;
  }
  patch.extra_fields = extras;
  patch.manual_overrides = [...overrides];

  const partNo = String(patch.part_no ?? "");
  patch.part_no_norm = normalizePartNo(partNo);
  return patch;
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized Excel reverse-sync request." }, { status: 401 });

  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BYTES) return NextResponse.json({ error: "Snapshot exceeds the 3.8 MB limit. Send fewer rows per request." }, { status: 413 });

  const body = await request.json().catch(() => null) as { type?: string; source?: string; rows?: ExcelRow[] } | null;
  if (!body || body.type !== "imds_master_snapshot" || !Array.isArray(body.rows)) {
    return NextResponse.json({ error: "Expected type=imds_master_snapshot and a rows array." }, { status: 400 });
  }
  if (body.rows.length < 1 || body.rows.length > MAX_ROWS) {
    return NextResponse.json({ error: `Snapshot must contain between 1 and ${MAX_ROWS} rows.` }, { status: 422 });
  }
  const serializedBytes = Buffer.byteLength(JSON.stringify(body.rows), "utf8");
  if (serializedBytes > MAX_BYTES) return NextResponse.json({ error: "Snapshot exceeds the 3.8 MB payload limit." }, { status: 413 });

  const supabase = createAdminClient();
  if (!supabase) return NextResponse.json({ error: "Supabase service-role connection is not configured." }, { status: 503 });

  const prepared: Array<Record<string, unknown>> = [];
  const occurrences = new Map<string, number>();
  const explicitKeyCounts = new Map<string, number>();
  const duplicateKeyWarnings: string[] = [];
  let skipped = 0;

  for (let index = 0; index < body.rows.length; index++) {
    const row = body.rows[index];
    if (!row || typeof row !== "object" || Array.isArray(row)) { skipped++; continue; }
    const partNo = cleanText(readCell(row, ["P/No.", "P/No", "Part No."]).value);
    const company = cleanText(readCell(row, ["COMPANY NAME", "Company Name"]).value);
    if (!partNo || !company) { skipped++; continue; }

    const suppliedKey = cleanText(readCell(row, ["MasterKey", "master_key"]).value);
    const sequenceNo = cleanText(readCell(row, ["No."]).value);
    let masterKey = suppliedKey || buildMasterKey(row, occurrences);
    const repeated = explicitKeyCounts.get(masterKey) || 0;
    explicitKeyCounts.set(masterKey, repeated + 1);
    if (repeated > 0) {
      duplicateKeyWarnings.push(masterKey);
      masterKey = createHash("sha256").update(`${masterKey}|duplicate:${repeated}`).digest("hex");
    }

    prepared.push({ master_key: masterKey, _sourceRow: index + 7, _source: row, _sequenceNo: sequenceNo, _generatedKey: !suppliedKey });
  }

  if (!prepared.length) return NextResponse.json({ error: "No valid rows with COMPANY NAME and P/No. were found." }, { status: 422 });

  const keys = prepared.map((row) => String(row.master_key));
  const existing = new Map<string, Record<string, unknown>>();
  for (let index = 0; index < keys.length; index += 300) {
    const { data, error } = await supabase.from("imds_master_parts")
      .select("*")
      .in("master_key", keys.slice(index, index + 300));
    if (error) return NextResponse.json({ error: `Could not read current master rows: ${error.message}` }, { status: 500 });
    for (const item of data || []) existing.set(String(item.master_key), item as Record<string, unknown>);
  }

  const rows = prepared.map((item) => {
    const key = String(item.master_key);
    const prior = existing.get(key);
    const source = item._source as ExcelRow;
    const row = toMasterRow(source, Number(item._sourceRow), key, prior);
    return {
      ...row,
      master_key: key,
      source_file_hash: prior?.source_file_hash ?? null
    };
  });

  let inserted = 0;
  let updated = 0;
  for (let index = 0; index < rows.length; index += CHUNK_SIZE) {
    const chunk = rows.slice(index, index + CHUNK_SIZE);
    for (const row of chunk) {
      if (existing.has(String(row.master_key))) updated++;
      else inserted++;
    }
    const { error } = await supabase.from("imds_master_parts").upsert(chunk, { onConflict: "master_key" });
    if (error) return NextResponse.json({ error: `Excel snapshot could not be applied at row ${index + 1}: ${error.message}` }, { status: 500 });
  }

  const assignedKeys = prepared
    .filter((item) => item._generatedKey === true)
    .map((item) => ({ no: item._sequenceNo, masterKey: item.master_key }))
    .filter((item) => item.no);

  return NextResponse.json({
    ok: true,
    source: body.source || "sharepoint_excel",
    totalRows: body.rows.length,
    inserted,
    updated,
    skipped,
    duplicateMasterKeys: duplicateKeyWarnings.length,
    assignedKeys,
    warning: prepared.some((item) => item._generatedKey === true && !item._sequenceNo)
      ? "Some new rows do not have a unique No. value. Add a unique No. in Excel so Power Automate can write the generated MasterKey back into the table."
      : undefined,
    note: "Excel rows were merged into the shared master. Rows missing from the snapshot are retained; no row was deleted."
  }, { headers: { "Cache-Control": "no-store" } });
}
