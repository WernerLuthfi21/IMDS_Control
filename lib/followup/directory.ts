// Supplier Directory (settings key "directory") read on the server, with the same rules the Tracker page uses
// (private/imds-tracker.html: findDirEntry / contactLookup). Pure functions, unit-tested.
//
// Strata (one field set per person, keys kept from the supplier database import):
//   IMDS PIC        pic1..pic3 (+ "Additional PIC emails" pic_extra, + additional contacts marked "To")
//   Additional      entry.x[]: name, position, email, phone, role "to" | "cc" | "none"  (e.g. people who are always on CC)
//   Middle mgmt     staff (marketing staff, PIC to TMMIN), spv, dph (department head), gm
//   Top mgmt        md (marketing director)
//   Director        vp (vice president director), pd (president director)
// When a supplier has no IMDS PIC e-mail, the e-mail goes To middle management instead (staff/supervisor first,
// else department head / GM), so nobody is skipped; the screen says so.
import { emailsOf } from "./recipients";

export type DirPerson = { name?: string; position?: string; email?: string; phone?: string; role?: "to" | "cc" | "none" };
export type DirEntry = { name: string; code?: string; type?: string; f?: Record<string, string>; x?: DirPerson[]; m?: Record<string, number> };
export type DirBuyer = { full?: string; email?: string; phone?: string };
export type Directory = { entries?: Record<string, DirEntry>; buyers?: Record<string, DirBuyer>; aliases?: Record<string, string> };

export const STRATA = {
  pic: ["pic1", "pic2", "pic3"],
  mid: ["staff", "spv", "dph", "gm"],
  top: ["md"],
  dir: ["vp", "pd"]
} as const;

/** PUD buyers (TMMIN purchasing). Used when the Directory has no e-mail for a buyer. Same list in the Tracker page. */
export const BUILTIN_BUYERS: Record<string, { full: string; email: string }> = {
  Puguh: { full: "Wahyu Puguh Bakhtiar", email: "wahyu.bakhtiar@toyota.co.id" },
  Luthfy: { full: "Ahmad Syofyan (Luthfy)", email: "ahmad.syofyan@toyota.co.id" },
  Omen: { full: "Fathurohman (Omen)", email: "Fathurohman@toyota.co.id" },
  Irman: { full: "Irman Firmansyah", email: "irman.firmansyah@toyota.co.id" },
  Taris: { full: "Adabina Ladiva (Taris)", email: "adabina.ladiva@toyota.co.id" },
  Liza: { full: "Elizabeth Listya (Liza)", email: "elizabeth.listya@toyota.co.id" },
  Aries: { full: "Aries Fredi", email: "aries.fredi@toyota.co.id" },
  Bangun: { full: "Arif Santoso (Bangun)", email: "arif.santoso@toyota.co.id" },
  Fifi: { full: "Anindya Darmawan (Fifi)", email: "anindya.darmawan@toyota.co.id" },
  Regia: { full: "Regia Erfawinanda", email: "regia.erfawinanda@toyota.co.id" }
};

const clean = (v: unknown) => String(v ?? "").replace(/[​-‍﻿]/g, "").replace(/\s+/g, " ").trim();
export function nameKey(s: unknown): string {
  return String(s ?? "").toUpperCase().replace(/&/g, " AND ").replace(/[^A-Z0-9]+/g, " ").trim().split(" ").filter((w) => w && w !== "PT" && w !== "CV" && w !== "TBK").join(" ");
}
const GENERIC = new Set(["INDONESIA", "INDONESI", "INDUSTRIES", "INDUSTRI", "INDUSTRY", "CORP", "CORPORATION", "CO", "LTD", "MFG", "MANUFACTURING", "AND", "THE", "JAYA", "PRIMA", "UTAMA"]);
const loose = (s: unknown) => nameKey(s).split(" ").filter((w) => w && !GENERIC.has(w));
const codeKey = (c: unknown) => clean(c).toUpperCase().replace(/\.0$/, "");
function jaccard(a: string[], b: string[]) {
  if (!a.length || !b.length) return 0;
  const A = new Set(a), B = new Set(b); let i = 0; A.forEach((x) => { if (B.has(x)) i++; });
  return i / (A.size + B.size - i);
}

/** vendor code → alias → exact name → unique loose name → fuzzy (≥ .75, unambiguous). Same order as the Tracker page. */
export function findEntry(dir: Directory, company: string, vendorCode?: string | null): { key: string; how: "code" | "linked" | "name" | "fuzzy" } | null {
  const entries = dir.entries || {};
  const al = (dir.aliases || {})[nameKey(company)];
  if (al && entries[al]) return { key: al, how: "linked" };
  const c = codeKey(vendorCode);
  if (c) { const k = Object.keys(entries).find((k2) => codeKey(entries[k2].code) === c); if (k) return { key: k, how: "code" }; }
  const nk = nameKey(company); if (entries[nk]) return { key: nk, how: "name" };
  const t = loose(company), lk = t.join(" ");
  const sameLoose = Object.keys(entries).filter((k) => loose(entries[k].name).join(" ") === lk);
  if (lk && sameLoose.length === 1) return { key: sameLoose[0], how: "name" };
  let best: string | null = null, bs = 0, tie = false;
  for (const k of Object.keys(entries)) { const s = jaccard(t, loose(entries[k].name)); if (s > bs) { bs = s; best = k; tie = false; } else if (s === bs && s > 0) tie = true; }
  return best && bs >= 0.75 && !tie ? { key: best, how: "fuzzy" } : null;
}

const uniq = (list: string[], skip: string[] = []) => {
  const seen = new Set(skip.map((e) => e.toLowerCase())), out: string[] = [];
  for (const e of list) { const k = e.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(e); } }
  return out;
};
const mailsOf = (f: Record<string, string>, people: readonly string[]) => people.flatMap((p) => emailsOf(f[p + "_email"] || ""));

export type Contacts = {
  to: string[]; ccAlways: string[]; mid: string[]; top: string[]; dir: string[]; buyer: { short: string; name: string; emails: string[] } | null;
  /** "pic" = IMDS PIC; "mid" = no PIC, middle management used instead; "master" = e-mail from the master sheet; "none" */
  toFrom: "pic" | "mid" | "master" | "none"; entryKey: string | null; how: string | null;
};

export function resolveContacts(dir: Directory, company: string, opts: { vendorCode?: string | null; masterEmail?: string | null; fallbackMid?: boolean } = {}): Contacts {
  const hit = findEntry(dir, company, opts.vendorCode);
  const e = hit ? (dir.entries || {})[hit.key] : null, f = e?.f || {}, x = Array.isArray(e?.x) ? e!.x! : [];
  const extraTo = x.filter((p) => (p.role || "cc") === "to").flatMap((p) => emailsOf(p.email || ""));
  const ccAlways = x.filter((p) => (p.role || "cc") === "cc").flatMap((p) => emailsOf(p.email || ""));
  let to = uniq([...mailsOf(f, STRATA.pic), ...emailsOf(f.pic_extra || ""), ...extraTo]);
  const mid = uniq(mailsOf(f, STRATA.mid)), top = uniq(mailsOf(f, STRATA.top)), director = uniq(mailsOf(f, STRATA.dir));
  let toFrom: Contacts["toFrom"] = to.length ? "pic" : "none";
  if (!to.length && opts.fallbackMid !== false) {
    const first = uniq(mailsOf(f, ["staff", "spv"])), second = uniq(mailsOf(f, ["dph", "gm"]));
    to = first.length ? first : second;
    if (to.length) toFrom = "mid";
  }
  if (!to.length) { to = uniq(emailsOf(opts.masterEmail || "")); if (to.length) toFrom = "master"; }
  const short = clean(f.buyer);
  const b = short ? { ...(BUILTIN_BUYERS[short] || {}), ...((dir.buyers || {})[short] || {}) } as DirBuyer : null;
  const buyerMails = b ? uniq(emailsOf(b.email || "").concat(emailsOf(BUILTIN_BUYERS[short]?.email || ""))).slice(0, 1) : [];
  return {
    to, ccAlways: uniq(ccAlways, to), mid: uniq(mid, to), top: uniq(top, to), dir: uniq(director, to),
    buyer: short ? { short, name: b?.full || short, emails: buyerMails } : null,
    toFrom, entryKey: hit?.key ?? null, how: hit?.how ?? null
  };
}
