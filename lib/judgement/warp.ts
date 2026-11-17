import master from "@/data/reference/purchasing-supplier-code-master.json";

/**
 * Appendix I No.21 "WARP Part number": the supplier code must be registered in the Purchasing
 * supplier code master (Supplier_Code.xlsx, PROTECTED, owner-confirmed 2026-11-18).
 * A registered code with a matching company name is confirmed by the master itself;
 * otherwise Purchasing has to confirm.
 */
type Entry = { code: string; codeKey: string; name: string; nameKey: string };
const ENTRIES = (master as { entries: Entry[] }).entries;
const BY_CODE = new Map(ENTRIES.map((e) => [e.codeKey, e]));
export const WARP_SOURCE = `${(master as { meta: { sourceFile: string; version: string } }).meta.version} (${(master as { meta: { sourceFile: string } }).meta.sourceFile})`;

export const codeKey = (c: string | null | undefined) => String(c ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const companyKey = (n: string | null | undefined) => String(n ?? "").toUpperCase().replace(/\bPT\b\.?|\bTBK\b\.?|\bCV\b\.?/g, "").replace(/[^A-Z0-9]+/g, " ").trim();

export type WarpCheck =
  | { found: false; reason: string }
  | { found: true; masterName: string; nameMatches: boolean | null; reason: string };

export function checkWarp(supplierCode: string | null | undefined, companyName: string | null | undefined): WarpCheck {
  const k = codeKey(supplierCode);
  if (!k) return { found: false, reason: "No supplier code on the record." };
  const hit = BY_CODE.get(k);
  if (!hit) return { found: false, reason: `Supplier code ${supplierCode} is not in the Purchasing supplier code master.` };
  const a = companyKey(companyName), b = hit.nameKey;
  const nameMatches = a ? (a === b || a.startsWith(b) || b.startsWith(a)) : null;
  return { found: true, masterName: hit.name, nameMatches,
    reason: `Supplier code ${supplierCode} is registered as "${hit.name}"${nameMatches === false ? ` but the record says "${companyName}"` : nameMatches ? ", company name matches" : ""}.` };
}
export const isWarpError = (errorType: string) => /\bwarp\b/i.test(errorType) || /^\s*(?:error\s*type\s*)?21(?:\.0)?\s*$/i.test(errorType);
