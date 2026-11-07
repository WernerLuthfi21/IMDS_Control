// Pure helpers for the "Preview & fix" step: which cells look wrong BEFORE the check runs. No I/O (unit-tested).
import { casCells, numberText, type Detection, type Field } from "@/lib/intake/detect";
import { partKey } from "@/lib/intake/keys";

export type CellIssue = { level: "error" | "warn"; text: string };
const NUMERIC: Field[] = ["contentPct", "imdsMass", "drawingMass"];

/** Issues keyed "row,col" (0-based matrix coordinates) for every data row. */
export function cellIssues(matrix: string[][], det: Detection): Map<string, CellIssue> {
  const out = new Map<string, CellIssue>();
  const m = det.mapping;
  const seen = new Map<string, number>();
  const ppm = m.contentPct !== undefined && /ppm/i.test(matrix[det.headerRow ?? 0]?.[m.contentPct] ?? "");
  for (let r = det.dataStart; r < matrix.length; r++) {
    const row = matrix[r];
    if (!row.some((c) => c.trim())) continue;
    const at = (f: Field) => (m[f] === undefined ? "" : (row[m[f]!] ?? "").trim());
    if (m.partNo !== undefined && !at("partNo")) out.set(`${r},${m.partNo}`, { level: "error", text: "Part No. is empty" });
    if (m.cas !== undefined) {
      const v = at("cas");
      if (!v) out.set(`${r},${m.cas}`, { level: "error", text: "CAS is empty" });
      else { const p = casCells(v); if (p.issue) out.set(`${r},${m.cas}`, { level: p.cas.length ? "warn" : "error", text: p.issue }); }
    }
    for (const f of NUMERIC) {
      const v = at(f);
      if (v && m[f] !== undefined && !numberText(v, f === "contentPct" && ppm)) out.set(`${r},${m[f]}`, { level: "warn", text: `“${v}” is not a number` });
    }
    if (m.toleranceClass !== undefined) { const v = at("toleranceClass").toUpperCase(); if (v && !/^M[A-F]$/.test(v)) out.set(`${r},${m.toleranceClass}`, { level: "warn", text: "Tolerance class should be MA–MF" }); }
    if (m.partNo !== undefined && at("partNo")) {
      const k = partKey(at("partNo")) + "|" + (m.cas !== undefined ? at("cas") : "");
      if (seen.has(k)) out.set(`${r},${m.partNo}`, { level: "warn", text: `Same part and CAS as row ${seen.get(k)! + 1}` }); else seen.set(k, r);
    }
  }
  return out;
}

export function problemRows(issues: Map<string, CellIssue>): Set<number> { return new Set(Array.from(issues.keys()).map((k) => Number(k.split(",")[0]))); }
