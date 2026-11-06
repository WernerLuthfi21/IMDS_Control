import type ExcelJS from "exceljs";

export function cleanCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (typeof v.text === "string") return v.text.trim();
    if (Array.isArray(v.richText)) return v.richText.map((x) => (x as { text?: string }).text || "").join("").trim();
    if (typeof v.result === "string" || typeof v.result === "number") return String(v.result).trim();
    if (typeof v.hyperlink === "string") return String(v.text || v.hyperlink).trim();
    if (typeof v.error === "string") return v.error.trim();
    return "";
  }
  const text = String(value).replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  return /^#N\/A$/i.test(text) ? "" : text;
}

export function plainCell(value: ExcelJS.CellValue): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (typeof v.text === "string") return v.text;
    if (Array.isArray(v.richText)) return v.richText.map((x) => (x as { text?: string }).text || "").join("");
    if (typeof v.result === "string" || typeof v.result === "number") return v.result;
    if (typeof v.hyperlink === "string") return String(v.text || v.hyperlink);
    if (typeof v.error === "string") return v.error;
    return JSON.stringify(value) ?? String(value);
  }
  return String(value);
}

export function normHeader(value: unknown): string {
  return cleanCell(value).toLowerCase().replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();
}

export function findHeaderRow(sheet: ExcelJS.Worksheet, required: string[][], maxRows = 20): number {
  for (let rowNo = 1; rowNo <= Math.min(sheet.rowCount, maxRows); rowNo++) {
    const values = sheet.getRow(rowNo).values as unknown[];
    const tokens = values.map(normHeader);
    const allFound = required.every((aliases) => tokens.some((token) => aliases.map(normHeader).includes(token)));
    if (allFound) return rowNo;
  }
  return 0;
}

export function buildHeaderMap(sheet: ExcelJS.Worksheet, rowNo: number): { headers: string[]; find: (aliases: string[]) => number } {
  const row = sheet.getRow(rowNo);
  const headers = Array.from({ length: Math.max(row.cellCount, sheet.columnCount) }, (_, i) => cleanCell(row.getCell(i + 1).value));
  const find = (aliases: string[]) => {
    const wanted = aliases.map(normHeader);
    const exact = headers.findIndex((h) => wanted.includes(normHeader(h)));
    return exact < 0 ? 0 : exact + 1;
  };
  return { headers, find };
}

export function parseExcelDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear(), m = String(value.getMonth() + 1).padStart(2, "0"), d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof value === "number" && value > 20000 && value < 80000) {
    const ms = Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  const text = cleanCell(value);
  if (!text) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (iso) return `${iso[1]}-${String(Number(iso[2])).padStart(2, "0")}-${String(Number(iso[3])).padStart(2, "0")}`;
  const dmy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(text);
  if (dmy) {
    const day = Number(dmy[1]), month = Number(dmy[2]), year = Number(dmy[3]);
    if (day > 12) return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (month > 12) return `${year}-${String(day).padStart(2, "0")}-${String(month).padStart(2, "0")}`;
    // Ambiguous dates in the supplied workbook are interpreted day-first (Indonesia).
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

export function normalizePartNo(value: unknown): string {
  return cleanCell(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function normalizeWords(value: unknown): string {
  return cleanCell(value).toUpperCase().replace(/\[[^\]]*\]/g, " ").replace(/\b(PT|TBK|CORPORATION|CORP|CO|LTD|LIMITED|INDONESIA)\b/g, " ").replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

export function vendorDigits(value: unknown): string {
  const digits = cleanCell(value).replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : digits;
}

export function uniqueEmails(value: unknown): string[] {
  return [...new Set(cleanCell(value).split(/[;,\s]+/).map((x) => x.trim()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)))];
}

export function excelSerialOrDate(value: unknown): unknown {
  return value instanceof Date ? parseExcelDate(value) : value;
}
