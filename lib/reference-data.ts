import gadsl from "@/data/reference/gadsl-reference-2026-v1.json";
import deletions from "@/data/reference/gadsl-deletions-2026-v1.json";
import tsz3 from "@/data/reference/appendix3-tsz-substance-groups.json";
import pops from "@/data/reference/appendix4-pops.json";
import annex17 from "@/data/reference/appendix5-reach-annex-xvii.json";
import annex14 from "@/data/reference/appendix6-reach-annex-xiv.json";

export type GadslRecord = (typeof gadsl.records)[number];
export const gadslRecords = gadsl.records as GadslRecord[];
export const gadslDeletedRecords = deletions.records;
export const tsz3Records = tsz3.records;
export const popsRecords = pops.records;
export const annex17Records = annex17.records;
export const annex14Records = annex14.records;

export function normalizeCas(value: string) {
  return value.trim().replace(/[\s‐‑‒–—]/g, "-").replace(/[^0-9-]/g, "");
}

export function isValidCas(value: string) {
  const cas = normalizeCas(value);
  if (!/^\d{2,7}-\d{2}-\d$/.test(cas)) return false;
  const digits = cas.replace(/-/g, "").slice(0, -1).split("").reverse();
  const sum = digits.reduce((acc, digit, index) => acc + Number(digit) * (index + 1), 0);
  return sum % 10 === Number(cas.split("-").at(-1));
}

function textHasCas(text: unknown, cas: string) {
  if (typeof text !== "string") return false;
  return text.replace(/_x000D_/g, "\n").split(/[\n,; ]+/).some((token) => normalizeCas(token) === cas);
}

export function lookupSubstance(rawCas: string) {
  const cas = normalizeCas(rawCas);
  const active = gadslRecords.filter((row) => normalizeCas(row.casOriginal || "") === cas);
  const tsz = tsz3Records.filter((row) => textHasCas(row.values?.[3], cas));
  const deleted = gadslDeletedRecords.filter((row) => normalizeCas(row.casOriginal || "") === cas);
  const relatedTszNumbers = new Set(tsz.map((row) => String(row.values?.[1] || "")));
  const popRows = popsRecords.filter((row) => relatedTszNumbers.has(String(row.values?.[1] || "")));
  const reach17Rows = annex17Records.filter((row) => relatedTszNumbers.has(String(row.values?.[1] || "")));
  const reach14Rows = annex14Records.filter((row) => relatedTszNumbers.has(String(row.values?.[1] || "")));
  return {
    casOriginal: rawCas,
    casNormalized: cas,
    formatValid: isValidCas(cas),
    gadsl: active,
    tszGroups: tsz,
    pops: popRows,
    reachAnnexXVII: reach17Rows,
    reachAnnexXIV: reach14Rows,
    deletedGadslMatches: deleted,
    notFound: active.length === 0 && tsz.length === 0 && deleted.length === 0,
    source: [
      "GADSL Reference List 2026 V1.0 / Reference List",
      "Appendix 3 TSZ0001G Substance Group & Judge Flow List",
      "Appendix 4 POPs Substance List",
      "Appendix 5 EU REACH Annex XVII List",
      "Appendix 6 EU REACH Annex XIV List"
    ]
  };
}
