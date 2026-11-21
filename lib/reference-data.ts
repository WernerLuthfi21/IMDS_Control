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


const firstLineOf = (v: unknown) => String(v ?? "").split(/\n/)[0].replace(/\s+/g, " ").trim();

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
  return normalizeSubstanceName(String(value ?? "").split(/\n/)[0].replace(/\([^)]*\)/g, " ").replace(/,?\s*all members?\b.*$/i, "").replace(/\s+and its .*$/i, ""));
}

type TszRow = (typeof tsz3Records)[number];
/** How a CAS reached an Appendix 3 group. `caution` set = a person must confirm (never auto-final). */
export type TszLink = { tszNo: string; matchedBy: "cas" | "gadsl-family" | "member-name" | "substance-name"; family: string; caution: string };

// ---- GADSL family structure (GADSL # column) ------------------------------------------------
// Member rows carry only REF #; the family row has GADSL # = REF # and the family name, e.g.
// 26027-38-3 → REF 160 → "4-Nonylphenol, branched and linear, ethoxylated, all members". PFAS
// families nest: "… identified in rows 179 to 181" makes #178 the parent of #179–#181.
let familyHeads: Map<string, GadslRecord> | null = null;
let familyParents: Map<string, string[]> | null = null;
function families() {
  if (!familyHeads || !familyParents) {
    familyHeads = new Map(); familyParents = new Map();
    for (const r of gadslRecords) { const n = String(r.gadslNumber || "").trim(); if (n && !familyHeads.has(n)) familyHeads.set(n, r); }
    for (const [n, head] of familyHeads) {
      const m = /identified in rows\s+(\d+)\s+to\s+(\d+)/i.exec(String(head.substance || ""));
      if (!m) continue;
      for (let k = Number(m[1]); k <= Number(m[2]); k++) if (String(k) !== n && familyHeads.has(String(k))) push(familyParents, String(k), n);
    }
  }
  return { heads: familyHeads, parents: familyParents };
}
/** Family rows of a GADSL record, nearest first (own family, then parents). */
export function gadslFamilyChain(record: GadslRecord): GadslRecord[] {
  const { heads, parents } = families();
  const out: GadslRecord[] = []; const seen = new Set<string>();
  const queue = [String(record.referenceNumber || record.gadslNumber || "").trim()].filter(Boolean);
  while (queue.length) {
    const n = queue.shift()!;
    if (seen.has(n)) continue;
    seen.add(n);
    const head = heads.get(n);
    if (!head) continue;
    out.push(head);
    queue.push(...(parents.get(n) ?? []));
  }
  return out;
}

const tableNo = (row: TszRow) => /see tsz0001g table\s*(\d+)/i.exec(String(row.values?.[3] ?? ""))?.[1] ?? "";
/** "selected" groups that name their CAS (or whose TSZ table rows are in Appendix 3) match by CAS only. */
function casOnly(row: TszRow) {
  const name = String(row.values?.[2] ?? ""), cell = String(row.values?.[3] ?? "");
  if (!/\bselected\b/i.test(name)) return false;
  const t = tableNo(row);
  if (t) return tsz3Records.some((r) => String(r.values?.[1] ?? "").startsWith(`Table ${t} -`));
  return !/various/i.test(cell);
}
/** Appendix 3 PFAS groups are "Per and Poly- fluoroalkyl substances (PFAS)\n<specific group>": match on the second line. */
function a3Key(row: TszRow) {
  const lines = String(row.values?.[2] ?? "").replace(/_x000D_/g, "").split(/\n/).map((l) => l.trim()).filter(Boolean);
  return lines.length > 1 && /\(PFAS\)/.test(lines[0]) ? { pfas: true, key: lines[1] } : { pfas: false, key: lines[0] ?? "" };
}
const carbonRange = (text: string) => { const m = /\(C(\d+)\s*-\s*C(\d+)\)/.exec(text); return m ? `C${m[1]}–C${m[2]}` : ""; };

function familyLinks(family: GadslRecord): Array<{ row: TszRow; caution: string }> {
  const fname = String(family.substance || "");
  const fbase = groupBase(fname);
  const out: Array<{ row: TszRow; caution: string }> = [];
  for (const row of tsz3Records) {
    if (/^Table \d+ -/.test(String(row.values?.[1] ?? "")) || casOnly(row)) continue;
    const { pfas, key } = a3Key(row);
    let hit = false; let caution = "";
    if (!pfas) {
      const kb = groupBase(key);
      hit = kb.length >= 3 && (normalizeSubstanceName(key) === normalizeSubstanceName(fname) || kb === fbase);
    } else {
      const acronym = /^([A-Z][A-Za-z]{2,6})\b/.exec(key)?.[1] ?? "";
      hit = Boolean(acronym) && (new RegExp("^\\s*" + acronym + "\\b").test(fname) || fname.includes(`(${acronym})`));
      const a = carbonRange(key), b = carbonRange(fname);
      if (hit && a && b && a !== b) caution = `Appendix 3 covers ${a}; the GADSL family covers ${b}. Check the chain length before judging.`;
    }
    if (!hit) continue;
    const t = tableNo(row);
    if (t) caution = [caution, `Appendix 3 lists this group in TSZ0001G Table ${t} (not in the uploaded appendices). Confirm the CAS is in that table.`].filter(Boolean).join(" ");
    out.push({ row, caution });
  }
  return out;
}
/** Appendix 3 splits GADSL "Diorganotin compounds" into dibutyltin and dioctyltin groups: decided by the member name. */
function diorganotinLinks(record: GadslRecord, chain: GadslRecord[]) {
  if (!chain.some((f) => /^diorganotin/i.test(normalizeSubstanceName(f.substance)))) return [] as TszRow[];
  const name = normalizeSubstanceName(record.substance);
  return tsz3Records.filter((row) => {
    const k = normalizeSubstanceName(row.values?.[2]);
    return (k.includes("dibutyltin") && /dibutyl\s?\w*\s?tin|dibutyl stann|stannane dibutyl/.test(name))
      || (k.includes("dioctyltin") && /dioctyl\s?\w*\s?tin|dioctyl stann|stannane dioctyl/.test(name));
  });
}

/**
 * Appendix 3 "all members" groups list no CAS ("Various"). When the CAS itself is not listed,
 * the group is found from the GADSL substance name of that CAS (e.g. 1336-36-3 → GADSL
 * "Polychlorinated biphenyls" → TSZ0001G "Polychlorinated biphenyls ( PCB ), all members").
 */
function groupsByName(names: string[]) {
  const bases = [...new Set(names.map(groupBase).filter((b) => b.length >= 3))];
  if (!bases.length) return [] as typeof tsz3Records;
  return tsz3Records.filter((row) => {
    if (!/all members|compounds|substances/i.test(String(row.values?.[2] ?? ""))) return false;
    const g = groupBase(row.values?.[2]);
    return g.length >= 3 && bases.some((b) => b === g || b.startsWith(g + " ") || g.startsWith(b + " "));
  });
}

export function lookupSubstance(rawCas: string) {
  const cas = normalizeCas(rawCas);
  const active = [...byGadslCas(cas)];
  // 1) CAS named in the Appendix 3 cell. 2) The GADSL family of the CAS (GADSL # / REF #, PFAS parents).
  // 3) Diorganotin split by member name. 4) Last resort: the member's own substance name.
  const links: Array<{ row: TszRow; link: TszLink }> = [];
  const add = (row: TszRow, matchedBy: TszLink["matchedBy"], family: string, caution = "") => {
    if (!links.some((l) => l.row === row)) links.push({ row, link: { tszNo: String(row.values?.[1] ?? "").trim(), matchedBy, family, caution } });
  };
  for (const row of tsz3Records) if (textHasCas(row.values?.[3], cas)) add(row, "cas", "");
  if (!links.length) {
    for (const rec of active) {
      const chain = gadslFamilyChain(rec);
      for (const fam of chain) {
        const found = familyLinks(fam);
        for (const f of found) add(f.row, "gadsl-family", firstLineOf(fam.substance), f.caution);
        if (found.length) break;
      }
      if (!links.length) for (const row of diorganotinLinks(rec, chain)) add(row, "member-name", firstLineOf(chain[0]?.substance), "");
    }
  }
  if (!links.length) for (const row of groupsByName(active.map((r) => String(r.substance || "")))) add(row, "substance-name", "", "Matched by the substance name only. Confirm the group.");
  const tsz = links.map((l) => l.row);
  const tszLinks = links.map((l) => l.link);
  const gadslFamilies = [...new Map(active.flatMap(gadslFamilyChain).map((f) => [String(f.gadslNumber), f])).values()]
    .map((f) => ({ gadslNumber: String(f.gadslNumber), substance: firstLineOf(f.substance), classification: f.classification, source: f.source, reportingThreshold: f.reportingThreshold }));
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
    tszLinks,
    gadslFamilies,
    tszMatchedBy: (tszLinks[0]?.matchedBy ?? null) as TszLink["matchedBy"] | null,
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
