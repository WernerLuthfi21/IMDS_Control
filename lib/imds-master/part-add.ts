// Adding part numbers to one supplier by pasting rows (from Excel, an e-mail or a PDF list). Pure rules, unit-tested:
// the route gives the supplier's context (company, vendor code, PIC e-mail, known models, due dates) and the
// existing master rows with the same part numbers; this file reads the paste, recognises the columns, fills what is
// missing so the row is complete and consistent with the master, and says what it did and what is wrong.
import { createHash } from "node:crypto";
import { cleanPartNo, normPartNo } from "./part-log";

export type AddContext = {
  company: string; vendorCode: string; email: string;
  /** Model keys already in the master (e.g. 737D, 688D). */
  models: string[];
  /** Model chosen in the dialog for rows that do not name one. */
  defaultModel: string;
  defaultStatus: string;
  due: { models?: Record<string, string>; suppliers?: Record<string, string> };
};
export type ExistingRow = { id: string; company_name?: string | null; project?: string | null; part_no?: string | null; part_no_norm?: string | null };
export type ParsedRow = {
  line: number; raw: string;
  partNo: string; partName: string; model: string; status: string; plan: string | null;
  /** What the system filled in itself ("model from the dialog", "plan = model deadline", …). */
  filled: string[];
  /** Problems that stop this row ("no part number", "already in the tracker"). */
  errors: string[];
  /** Things to look at, the row is still added ("unknown model", "also listed for another supplier"). */
  warnings: string[];
};
export type Columns = { partNo: number; partName: number; model: number; status: number; plan: number; header: boolean };

const STATUSES: [RegExp, string][] = [
  [/^(not\s*submit(ted)?(\s*yet)?|belum|missing|nsy)$/i, "NOT SUBMITTED YET"], [/^(working|on\s*process|in\s*process|under\s*judge?ment)$/i, "WORKING"],
  [/^(accepted|complete|ok|submitted)$/i, "ACCEPTED"], [/^reject(ed)?$/i, "REJECTED"], [/^(check|cek)$/i, "CHECK"]
];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTHS_ID: Record<string, number> = { mei: 5, agu: 8, agt: 8, okt: 10, des: 12 };
const clean = (v: unknown) => String(v ?? "").replace(/[​-‍﻿]/g, "").replace(/\s+/g, " ").trim();
export const modelKeyOf = (raw: unknown) => clean(raw).toUpperCase().replace(/\s*[-–—]\s*/g, "-");

/** A part number looks like 8211VKK030, 74404-KK090, 863C00K020: letters and digits, at least 5, with digits. */
export function looksLikePartNo(v: string): boolean {
  const s = clean(v);
  if (!s || /\s/.test(s) || s.length > 30) return false;
  const n = normPartNo(s);
  return n.length >= 7 && /\d/.test(n) && /^[A-Z0-9\-._/]+$/i.test(s) && !/^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(s);
}

/** 2026-11-30, 30/11/2026, 30-Nov-2026, 30 Nov 2026, 30 Des 2026, Excel serial 46356 → ISO; else null. */
export function parseDate(v: string): string | null {
  const s = clean(v);
  if (!s) return null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  const iso = (y: number, mo: number, d: number) => {
    const dt = new Date(Date.UTC(y, mo - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d && y >= 2000 && y <= 2100 ? dt.toISOString().slice(0, 10) : null;
  };
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s);
  if (m) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  m = /^(\d{1,2})[\s\-/.]+([A-Za-z]{3,9})[\s\-/.,]+(\d{2,4})$/.exec(s);
  if (m) {
    const k = m[2].slice(0, 3).toLowerCase(), mo = MONTHS.indexOf(k) + 1 || MONTHS_ID[k] || 0;
    if (mo) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], mo, +m[1]);
  }
  if (/^\d{5}(\.0+)?$/.test(s)) { const n = Math.floor(+s); if (n > 40000 && n < 60000) return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10); }
  return null;
}
export function parseStatus(v: string): string | null {
  const s = clean(v); for (const [re, out] of STATUSES) if (re.test(s)) return out; return null;
}

/** Rows and cells: tabs (Excel), else ; or |, else two or more spaces. Blank lines dropped. */
export function splitPaste(text: string): string[][] {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim());
  const sep = lines.some((l) => l.includes("\t")) ? /\t/ : lines.some((l) => /[;|]/.test(l)) ? /\s*[;|]\s*/ : /\s{2,}/;
  return lines.slice(0, 2000).map((l) => l.split(sep).map(clean));
}

const HEAD: [keyof Omit<Columns, "header">, RegExp][] = [
  ["partNo", /^(p\s*\/\s*no\.?|part\s*(no|number|num|#)\.?|pn|nomor\s*part|no\.?\s*part)$/i], ["partName", /^(part\s*name|name|nama(\s*part)?|description|desc)$/i],
  ["model", /^(model|project|proyek|car\s*model)$/i], ["status", /^(status|imds\s*status|part\s*status)$/i], ["plan", /^(plan|target|submission\s*plan|target\s*date|due|date|tanggal|plan\s*date)$/i]
];

/** Which column holds what: from a header row when there is one, otherwise from what the cells look like. */
export function detectColumns(rows: string[][], models: string[]): Columns {
  const cols: Columns = { partNo: -1, partName: -1, model: -1, status: -1, plan: -1, header: false };
  const first = rows[0] || [];
  first.forEach((c, i) => { for (const [k, re] of HEAD) if (cols[k] < 0 && re.test(c.replace(/[:*]/g, "").trim())) cols[k] = i; });
  if (cols.partNo >= 0) { cols.header = true; return cols; }
  Object.assign(cols, { partName: -1, model: -1, status: -1, plan: -1 });
  const width = Math.max(...rows.map((r) => r.length), 0), known = new Set(models.map(modelKeyOf));
  const score = (i: number, test: (v: string) => boolean) => rows.filter((r) => r[i] && test(r[i])).length / Math.max(1, rows.filter((r) => r[i]).length);
  const taken = new Set<number>();
  const pick = (test: (v: string) => boolean, min: number) => {
    let best = -1, bs = min;
    for (let i = 0; i < width; i++) { if (taken.has(i)) continue; const sc = score(i, test); if (sc > bs) { bs = sc; best = i; } }
    if (best >= 0) taken.add(best); return best;
  };
  cols.partNo = pick(looksLikePartNo, 0.5);
  cols.plan = pick((v) => parseDate(v) !== null, 0.5);
  cols.status = pick((v) => parseStatus(v) !== null, 0.5);
  cols.model = pick((v) => known.has(modelKeyOf(v)) || /^\d{3}[A-Z]{1,2}$/i.test(v.trim()), 0.5);
  cols.partName = pick((v) => /[A-Za-z]{3}/.test(v) && !looksLikePartNo(v), 0.3);
  if (/^(no\.?|#)$/i.test(first[0] || "") && cols.partNo === 0) cols.partNo = -1;
  return cols;
}

/** Same key formula as the master import (project | vendor | company | part number, first occurrence). */
export function masterKeyFor(project: string, vendorCode: string, company: string, partNo: string): string {
  const base = [project, vendorCode, company, normPartNo(partNo)].map((v) => v.toUpperCase().trim()).join("|");
  return createHash("sha256").update(`${base}|duplicate:0`).digest("hex");
}

export function parseParts(text: string, ctx: AddContext, existing: ExistingRow[]): { columns: Columns; rows: ParsedRow[] } {
  const cells = splitPaste(text);
  const columns = detectColumns(cells, ctx.models);
  const known = new Set(ctx.models.map(modelKeyOf));
  const up = (v: unknown) => clean(v).toUpperCase();
  const seen = new Map<string, number>();
  const rows: ParsedRow[] = [];
  cells.slice(columns.header ? 1 : 0).forEach((r, k) => {
    const line = k + (columns.header ? 2 : 1), raw = r.join(" | ");
    const get = (i: number) => (i >= 0 ? r[i] || "" : "");
    const out: ParsedRow = { line, raw, partNo: "", partName: "", model: "", status: "", plan: null, filled: [], errors: [], warnings: [] };
    // Part number: its column, else the first cell that looks like one.
    let pn = get(columns.partNo);
    const underHeader = columns.header && /\d/.test(pn) && normPartNo(pn).length >= 5 && !/\s/.test(pn.trim());
    if (!looksLikePartNo(pn) && !underHeader) pn = r.find(looksLikePartNo) || "";
    out.partNo = cleanPartNo(pn);
    if (!out.partNo || normPartNo(out.partNo).length < 5) out.errors.push("No part number found");
    out.partName = clean(get(columns.partName)).slice(0, 200);
    if (!out.partName) out.warnings.push("No part name (it can be added later)");
    const m = modelKeyOf(get(columns.model));
    if (m) { out.model = m; if (!known.has(m)) out.warnings.push(`Model ${m} is new in the tracker`); }
    else { out.model = modelKeyOf(ctx.defaultModel) || "UNASSIGNED"; out.filled.push(`model ${out.model}`); if (out.model === "UNASSIGNED") out.warnings.push("No model: choose one in the dialog"); }
    const st = parseStatus(get(columns.status));
    if (st) out.status = st; else { out.status = ctx.defaultStatus || "NOT SUBMITTED YET"; out.filled.push(`status ${out.status}`); }
    const pl = parseDate(get(columns.plan));
    if (pl) out.plan = pl;
    else {
      const sup = (ctx.due.suppliers || {})[up(ctx.company) + "|" + out.model], md = (ctx.due.models || {})[out.model];
      out.plan = sup || md || null;
      if (out.plan) out.filled.push(`plan ${out.plan} (${sup ? "supplier due date" : "model deadline"})`);
    }
    const norm = normPartNo(out.partNo);
    if (norm) {
      const dupKey = norm + "|" + out.model, first = seen.get(dupKey);
      if (first) out.errors.push(`Pasted twice (also line ${first})`); else seen.set(dupKey, line);
      const same = existing.filter((x) => (x.part_no_norm || normPartNo(x.part_no)) === norm);
      if (same.some((x) => up(x.company_name) === up(ctx.company) && up(x.project) === up(out.model))) out.errors.push("Already in the tracker for this supplier and model");
      else {
        const other = [...new Set(same.filter((x) => up(x.company_name) !== up(ctx.company)).map((x) => clean(x.company_name)))];
        if (other.length) out.warnings.push(`Also listed for ${other.slice(0, 2).join(", ")}${other.length > 2 ? " …" : ""}`);
        if (same.some((x) => up(x.company_name) === up(ctx.company) && up(x.project) !== up(out.model))) out.warnings.push("Same number exists for this supplier in another model");
      }
    }
    rows.push(out);
  });
  return { columns, rows };
}

/** Master rows to insert for the rows without errors. */
export function toInserts(rows: ParsedRow[], ctx: AddContext, userId: string, now: Date) {
  return rows.filter((r) => !r.errors.length).map((r) => ({
    master_key: masterKeyFor(r.model === "UNASSIGNED" ? "" : r.model, ctx.vendorCode, ctx.company, r.partNo),
    project: r.model === "UNASSIGNED" ? null : r.model, vendor_code: ctx.vendorCode || null, main_pic_email: ctx.email || null,
    company_name: ctx.company, part_name: r.partName || null, part_no: r.partNo, part_no_norm: normPartNo(r.partNo),
    submission_plan: r.plan, imds_status: r.status, source_file_name: "Added in the Tracker (paste)", source_sheet: null, source_row: null,
    extra_fields: { addedInTracker: now.toISOString() }, manual_overrides: [] as string[], updated_by: userId
  }));
}
