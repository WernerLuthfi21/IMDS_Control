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


function normalizeSubstanceName(value: unknown) {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

/** Exact normalized-name fallback when the IMDS row masks CAS. Ambiguous names stay in manual review. */
export function lookupSubstanceByName(rawName: string) {
  const key = normalizeSubstanceName(rawName);
  if (!key || key.length < 4) return { gadsl: [] as GadslRecord[], tsz: [] as typeof tsz3Records, casCandidates: [] as string[] };
  const gadsl = gadslRecords.filter((row) => normalizeSubstanceName(row.substance) === key);
  const tsz = tsz3Records.filter((row) => normalizeSubstanceName(row.values?.[2]) === key);
  const candidates = new Set<string>();
  for (const row of gadsl) {
    const cas = normalizeCas(row.casOriginal || "");
    if (isValidCas(cas)) candidates.add(cas);
  }
  for (const row of tsz) {
    const raw = String(row.values?.[3] ?? "");
    for (const match of raw.matchAll(/\b\d{2,7}\s*[-‐‑‒–—]\s*\d{2}\s*[-‐‑‒–—]\s*\d\b/g)) {
      const cas = normalizeCas(match[0]);
      if (isValidCas(cas)) candidates.add(cas);
    }
  }
  return { gadsl, tsz, casCandidates: [...candidates] };
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
