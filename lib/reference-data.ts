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

import { isValidCas, normalizeCas } from "@/lib/cas";
export { isValidCas, normalizeCas };

function textHasCas(text: unknown, cas: string) {
  if (typeof text !== "string") return false;
  return text.replace(/_x000D_/g, "\n").split(/[\n,; ]+/).some((token) => normalizeCas(token) === cas);
}


function normalizeSubstanceName(value: unknown) {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

// Lazy lookup indexes (built once per server instance): the lookups used to scan all 7,285 GADSL
// records on every call. Arrays keep the original record order, so results are identical.
let gadslCasIndex: Map<string, GadslRecord[]> | null = null;
let gadslNameIndex: Map<string, GadslRecord[]> | null = null;
let tszNameIndex: Map<string, typeof tsz3Records> | null = null;
function push<T>(m: Map<string, T[]>, k: string, v: T) { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); }
function byGadslCas(cas: string) {
  if (!gadslCasIndex) { gadslCasIndex = new Map(); for (const r of gadslRecords) push(gadslCasIndex, normalizeCas(r.casOriginal || ""), r); }
  return gadslCasIndex.get(cas) ?? [];
}
function byGadslName(key: string) {
  if (!gadslNameIndex) { gadslNameIndex = new Map(); for (const r of gadslRecords) push(gadslNameIndex, normalizeSubstanceName(r.substance), r); }
  return gadslNameIndex.get(key) ?? [];
}
function byTszName(key: string) {
  if (!tszNameIndex) { tszNameIndex = new Map(); for (const r of tsz3Records) push(tszNameIndex, normalizeSubstanceName(r.values?.[2]), r); }
  return tszNameIndex.get(key) ?? [];
}

/** Exact normalized-name fallback when the IMDS row masks CAS. Ambiguous names stay in manual review. */
export function lookupSubstanceByName(rawName: string) {
  const key = normalizeSubstanceName(rawName);
  if (!key || key.length < 4) return { gadsl: [] as GadslRecord[], tsz: [] as typeof tsz3Records, casCandidates: [] as string[] };
  const gadsl = [...byGadslName(key)];
  const tsz = [...byTszName(key)];
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

/** "Polychlorinated biphenyls ( PCB ), all members" -> "polychlorinated biphenyls". */
function groupBase(value: unknown) {
  return normalizeSubstanceName(String(value ?? "").split(/\n/)[0].replace(/\([^)]*\)/g, " ").replace(/,?\s*all members.*$/i, "").replace(/\s+and its .*$/i, ""));
}
/**
 * Appendix 3 "all members" groups list no CAS ("Various"). When the CAS itself is not listed,
 * the group is found from the GADSL substance name of that CAS (e.g. 1336-36-3 → GADSL
 * "Polychlorinated biphenyls" → TSZ0001G "Polychlorinated biphenyls ( PCB ), all members").
 */
/**
 * Appendix 3 lists four element families as "<element> and its compounds, all members" with CAS "Various"
 * (#5 Cadmium, #20 Lead, #21 Mercury, #42 Arsenic). By that wording every substance of the element is a member,
 * so a GADSL substance whose name contains the element (Lead, Lead monoxide, Tetraethyllead, Mercuric chloride,
 * Arsenic acid…) belongs to the family. Stems cover the -ic/-ous/-ate forms of the same element only.
 */
const ELEMENT_FAMILIES: Record<string, RegExp> = { lead: /lead|plumb/i, cadmium: /cadmium/i, mercury: /mercur/i, arsenic: /arsen/i };
function groupsByName(names: string[]) {
  const bases = [...new Set(names.map(groupBase).filter((b) => b.length >= 4))];
  if (!bases.length) return [] as typeof tsz3Records;
  return tsz3Records.filter((row) => {
    if (!/all members/i.test(String(row.values?.[2] ?? ""))) return false;
    const g = groupBase(row.values?.[2]);
    const family = /and its compounds/i.test(String(row.values?.[2] ?? "")) ? ELEMENT_FAMILIES[g] : undefined;
    if (family) return names.some((n) => family.test(String(n)));
    return g.length >= 8 && bases.some((b) => b.length >= 8 && (b === g || b.startsWith(g + " ") || g.startsWith(b + " ")));
  });
}

export function lookupSubstance(rawCas: string) {
  const cas = normalizeCas(rawCas);
  const active = [...byGadslCas(cas)];
  const byCas = tsz3Records.filter((row) => textHasCas(row.values?.[3], cas));
  const byName = byCas.length ? [] : groupsByName(active.map((row) => String(row.substance || "")));
  const tsz = byCas.length ? byCas : byName;
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
    tszMatchedBy: byCas.length ? "cas" as const : byName.length ? "group-name" as const : null,
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
