import Decimal from "decimal.js";
import { normalizeCas } from "@/lib/reference-data";
import { byHeader } from "@/lib/judgement/row-facts";

/**
 * G-CATS Manual Flow, Phthalates: "Is the total content of the four CAS (85-68-7, 117-81-7, 84-74-2, 84-69-5)
 * in the same material below 0.1wt%?" G-CATS lists one CAS per row, and each of the four is a prohibited
 * substance, so every one present in a material has its own error row. The total is the sum of those rows
 * for the same part, component, material and download date. Checked against the Master Data: every
 * "Below 0.1wt%" OK has a sum below 0.1 and every NG a sum of 0.1 or more (2026-11-21).
 */
export const FOUR_PHTHALATES = new Set(["85-68-7", "117-81-7", "84-74-2", "84-69-5"]);
type Raw = Record<string, unknown> | null | undefined;

export function materialKey(raw: Raw, partNo: string | null | undefined, supplierCode: string | null | undefined): string {
  const t = (h: string) => byHeader(raw, h).replace(/\s+/g, " ").trim().toUpperCase();
  return [String(partNo ?? "").trim().toUpperCase(), String(supplierCode ?? "").trim().toUpperCase(),
    t("Component Part No."), t("Material Name"), t("Download Date").slice(0, 10)].join("|");
}

/** Sum of the four phthalates in the material of `target`, or null when any content is missing or masked. */
export function fourPhthalateTotal(target: { raw: Raw; partNo: string | null; supplierCode: string | null }, siblings: Array<{ raw: Raw; partNo: string | null; supplierCode: string | null }>): { pct: string; rows: number } | null {
  const key = materialKey(target.raw, target.partNo, target.supplierCode);
  const seen = new Set<string>();
  let total = new Decimal(0); let rows = 0;
  for (const s of [target, ...siblings]) {
    if (materialKey(s.raw, s.partNo, s.supplierCode) !== key) continue;
    const cas = normalizeCas(byHeader(s.raw, "CAS No."));
    if (!FOUR_PHTHALATES.has(cas)) continue;
    const level = byHeader(s.raw, "Level"), comp = byHeader(s.raw, "Component Part Name");
    const id = [cas, level, comp].join("|");
    if (seen.has(id)) continue; // the same substance row reported twice
    seen.add(id);
    const v = byHeader(s.raw, "Substance Content(%)").replace(",", ".").trim();
    if (!v || !/^\d+(\.\d+)?$/.test(v)) return null;
    total = total.plus(new Decimal(v)); rows++;
  }
  return rows ? { pct: total.toString(), rows } : null;
}
