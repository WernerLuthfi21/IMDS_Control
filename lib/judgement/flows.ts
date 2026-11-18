import families from "@/data/reference/gcats-v5110-cas-families.json";
import t1 from "@/data/reference/gcats-v5110-t1-flows.json";
import { annex14Records, annex17Records, popsRecords } from "@/lib/reference-data";
import type { RowFacts } from "@/lib/judgement/row-facts";

/**
 * Executable versions of the G-CATS substance / ELV judge flow charts.
 * Primary source: G-CATS Manual Flow Ver.7 (TMC-MED(KM), appendices updated July 2026).
 * Flows Ver.7 does not cover keep the G-CATS judgment Ver.5.1.10 Appendix II chart (methanol,
 * paraffin oil, the 0.1wt% "T1" charts). Each flow walks the chart using what the source row
 * already says (content %, material, part names, application ID) and asks only for what the row
 * cannot know (destination, supplier answers, appendix checks). Every run records its source.
 */
export type FlowQuestion = { id: string; text: string; options: Array<[string, string]> };
export type FlowOutcome = { state: "OK" | "NG" | "HOLD"; comment: string; reason: string };
export type FlowRun = {
  flowId: string; title: string; page: number | null; implemented: boolean;
  trail: Array<{ question: string; answer: string; auto: boolean }>;
  next: FlowQuestion | null; outcome: FlowOutcome | null;
  /** Source document of this flow chart. */
  source: string;
  /** People may confirm the result, the system never finalises it (draft source or a value taken from a draft). */
  draft: boolean;
  /** Why `draft` is set, shown on the card. */
  caution?: string;
};
import { DESTINATION_OPTIONS, TOYOTA_OWNED } from "@/lib/judgement/constants";
export { DESTINATION_OPTIONS, TOYOTA_OWNED };
const YN: Array<[string, string]> = [["Y", "Yes"], ["N", "No"]];
const SRC5 = "G-CATS judgment Ver.5.1.10, Appendix II";
export const SRC7 = "G-CATS Manual Flow Ver.7";
/** Ver.7 No.19 chart; the regulatory countries come from the slide "Reference: MCCP judge flow (draft)" (RI CM 2026-02). */
export const MCCP_SOURCE = "G-CATS Manual Flow Ver.7, No.19 MCCP (p.37) · regulatory countries from the MCCP judge flow draft (RI CM 2026-02)";
/** Regulatory countries for MCCP: "Appendix 4 TSZ0001G x POPs Substance List (as of 2026 May: EU, JP)" — the draft MCCP deck. */
export const MCCP_REGULATED = new Set(["EU", "JP"]);
const SUPPLIER_AB: Array<[string, string]> = [["A", "A · Input mistake"], ["B", "B · It contains"]];
const INTENT: Array<[string, string]> = [["A", "A · Non-intentional use"], ["B", "B · Intentional use"]];
const LEGAL: Array<[string, string]> = [["A", "A · It meets the legal requirements"], ["B", "B · It does not meet the requirements"], ["C", "C · It is difficult to judge"]];

class Ctx {
  trail: FlowRun["trail"] = [];
  next: FlowQuestion | null = null;
  constructor(readonly f: RowFacts, readonly a: Record<string, string>) {}
  ask(id: string, text: string, options: Array<[string, string]> = YN): string | undefined {
    const v = this.a[id];
    const hit = options.find((o) => o[0] === v);
    if (hit) { this.trail.push({ question: text, answer: hit[1], auto: false }); return hit[0]; }
    if (!this.next) this.next = { id, text, options };
    return undefined;
  }
  auto(text: string, answer: string, value: string) { this.trail.push({ question: text, answer, auto: true }); return value; }
  today(): string { return this.a.__today || new Date().toISOString().slice(0, 10); }
  dest(text = "Vehicle destination"): string | undefined { return this.ask("destination", text, DESTINATION_OPTIONS); }
  /** Destination → "EU destination?" (Y/N). */
  eu(): "Y" | "N" | undefined {
    const d = this.dest();
    return d === undefined ? undefined : d === "EU" ? "Y" : "N";
  }
  /** "North America destination?" — the listed destinations are not North America; only "Other" asks. */
  northAmerica(): "Y" | "N" | undefined {
    const d = this.dest(); if (!d) return;
    if (d !== "OTH") return this.auto("North America destination?", `${d} → No`, "N") as "N";
    return this.ask("naDest", "Is the vehicle bound for North America?") as "Y" | "N" | undefined;
  }
  /** Is the substance content at or below `limit` wt%? Uses the row's content when present. */
  below(id: string, text: string, limit: number, strict = false): "Y" | "N" | undefined {
    const n = Number(String(this.f.substanceContentPct).replace(",", "."));
    const yes = strict ? n < limit : n <= limit;
    if (this.f.substanceContentPct && Number.isFinite(n)) return this.auto(text, `${this.f.substanceContentPct}% from the row → ${yes ? "Yes" : "No"}`, yes ? "Y" : "N") as "Y" | "N";
    return this.ask(id, text) as "Y" | "N" | undefined;
  }
  /** A yes/no the row text can confirm: auto "Yes" when the text matches, otherwise a person answers. */
  textYes(id: string, text: string, value: string, re: RegExp): "Y" | "N" | undefined {
    if (value && re.test(value)) return this.auto(text, `${value} from the row → Yes`, "Y") as "Y";
    return this.ask(id, text) as "Y" | "N" | undefined;
  }
  get parts() { return [this.f.deliveryPartName, this.f.componentPartName].filter(Boolean).join(" / "); }
  out(state: FlowOutcome["state"], comment: string, reason: string): FlowOutcome { return { state, comment, reason }; }
}

type Def = { id: string; title: string; page: number | null; source?: string; draft?: boolean; caution?: string; run: (c: Ctx) => FlowOutcome | undefined };
const ok = (c: Ctx, comment: string) => c.out("OK", comment, `Flow result: Judge OK — "${comment}"`);
const ng = (c: Ctx, comment: string) => c.out("NG", comment, `Flow result: Judge NG — "${comment}"`);
const contactTmc = (c: Ctx, why: string) => c.out("HOLD", "", `${why} Contact TMC/TMNA/TME/TMA; do not judge yet.`);
const reportTmc = (c: Ctx, why: string) => c.out("HOLD", "", `${why} Report the P/N and supplier information immediately to TME/TMNA/TMA and TMC (detail TBD). Contact TMC; do not judge yet.`);
const BELOW = "The substance is below threshold.";
const NON_REG = "Only non-Regulated destination.";
const CONTAINED = "Prohibited substance(s) is contained.";
const NOT_PROHIBIT = "Use is not prohibit.";
const MISTAKE = "Supplier input mistake.";
const clean = (v: unknown) => String(v ?? "").replace(/_x000D_/g, " ").replace(/\s+/g, " ").trim();

/** Supplier step shared by most charts: A input mistake → NG, B it contains → `onContains`. */
function supplierStep(c: Ctx, onContains: () => FlowOutcome | undefined, text = "Confirm to supplier"): FlowOutcome | undefined {
  const s = c.ask("supplier", text, SUPPLIER_AB); if (!s) return;
  return s === "A" ? ng(c, MISTAKE) : onContains();
}

/** Appendix 4 (POPs list) cells for the TSZ group and the destination column. */
function popsHint(tsz: string, dest: string): string {
  const col = dest === "JP" ? 5 : dest === "EU" ? 6 : dest === "CN" ? 9 : 12;
  const colName = dest === "JP" ? "JP" : dest === "EU" ? "EU" : dest === "CN" ? "China" : "Others";
  const rows = popsRecords.filter((r) => clean(r.values?.[1]) === tsz).map((r) => `${clean(r.values?.[3])}: ${clean(r.values?.[col]) || "—"}`).filter((s) => !s.startsWith(": "));
  return rows.length ? ` Appendix 4 (POPs list), TSZ0001G #${tsz}, ${colName} column — ${rows.join(" · ")}.` : ` TSZ0001G #${tsz || "—"} is not in Appendix 4; read TSZ0001G.`;
}
function annex17Hint(tsz: string): string {
  const rows = annex17Records.filter((r) => clean(r.values?.[1]) === tsz).map((r) => `Entry ${clean(r.values?.[2]) || "—"} · ${clean(r.values?.[5])}: ${clean(r.values?.[6]) || "—"}`);
  return rows.length ? ` Appendix 5 (REACH Annex XVII), TSZ0001G #${tsz} — ${Array.from(new Set(rows)).slice(0, 4).join(" · ")}.` : "";
}

/** POPs / Annex XVII step: compare with the appendix. */
function legalStep(c: Ctx, appendix: string, hint: string): FlowOutcome | undefined {
  const l = c.ask("appendixLegal", `Compare with ${appendix}: does it meet the legal requirements?${hint}`, LEGAL); if (!l) return;
  if (l === "A") return ok(c, BELOW);
  if (l === "C") return reportTmc(c, `${appendix} check is difficult to judge; also confirm to the supplier whether the input is a mistake.`);
  return supplierStep(c, () => reportTmc(c, "Supplier confirms the substance is contained and the appendix requirement is not met."), "Confirm to supplier immediately: is it an input mistake?");
}

function appId20(c: Ctx): "Y" | "N" | undefined {
  const id = c.f.applicationId.trim();
  if (id) return c.auto("Application ID is 20 (other application, potentially prohibited)?", `${id} from the row → ${id === "20" ? "Yes" : "No"}`, id === "20" ? "Y" : "N") as "Y" | "N";
  return c.ask("app20", "Is the Application ID 20 (other application, potentially prohibited)?") as "Y" | "N" | undefined;
}
function elvFlow(c: Ctx, sub: string, limit: number, label: string): FlowOutcome | undefined {
  const app = appId20(c); if (!app) return;
  const contains = () => supplierStep(c, () => contactTmc(c, `Supplier confirms ${sub} is contained.`));
  if (app === "Y") return contains();
  const t = c.below("thr", `Below ${label}? (${label} is OK)`, limit); if (!t) return;
  return t === "Y" ? ok(c, BELOW) : contains();
}

const DEFS: Record<string, Def> = {
  // ---------- G-CATS Manual Flow Ver.7 ----------
  elvCd: { id: "elvCd", title: "No.11 ELV (Cd)", page: 19, source: SRC7, run: (c) => elvFlow(c, "Cd", 0.01, "0.01wt%") },
  elvHg: { id: "elvHg", title: "No.12 ELV (Hg)", page: 20, source: SRC7, run: (c) => {
    const app = appId20(c); if (!app) return;
    const contains = () => supplierStep(c, () => contactTmc(c, "Supplier confirms Hg is contained."));
    if (app === "Y") return contains();
    const t = c.below("thr", "Below 0.1wt%? (0.1wt% is OK)", 0.1); if (!t) return;
    if (t === "N") return contains();
    const d = c.dest(); if (!d) return;
    const jpNa = d === "JP" ? c.auto("Japan or North America destination?", "JP → Yes", "Y")
      : d !== "OTH" ? c.auto("Japan or North America destination?", `${d} → No`, "N")
      : c.ask("naDest", "Is the vehicle bound for North America?");
    if (!jpNa) return;
    if (jpNa === "N") return ok(c, BELOW);
    const id = c.f.applicationId.trim();
    const a46 = id ? c.auto("Application ID is 46 (concentration within acceptable GADSL limits)?", `${id} from the row → ${id === "46" ? "Yes" : "No"}`, id === "46" ? "Y" : "N") : c.ask("app46", "Is the Application ID 46 (concentration within acceptable GADSL limits)?");
    if (!a46) return;
    return a46 === "Y" ? ok(c, "The substance is unintentional use.") : c.out("NG", CONTAINED, `Flow result: Judge NG — "${CONTAINED}" Contact TMC/TMNA/TME/TMA.`);
  } },
  elvCr: { id: "elvCr", title: "No.13 ELV (Cr6+)", page: 21, source: SRC7, run: (c) => elvFlow(c, "Cr6+", 0.1, "0.1wt%") },
  pops: { id: "pops", title: "No.14 Prohibited substance: POPs", page: 22, source: SRC7, run: (c) => {
    const d = c.dest(); if (!d) return;
    return legalStep(c, "Appendix 4 (TSZ0001G x POPs list)", popsHint(c.a.__tsz ?? "", d));
  } },
  annex17: { id: "annex17", title: "No.14 Prohibited substance: EU REACH Annex XVII", page: 23, source: SRC7, run: (c) => {
    const eu = c.eu(); if (!eu) return;
    const tsz = c.a.__tsz ?? "";
    if (eu === "N") {
      const non = annex17Records.filter((r) => clean(r.values?.[1]) === tsz).map((r) => clean(r.values?.[7])).filter((v) => v && !/^no information$/i.test(v));
      if (!non.length) { c.auto("Non-EU destination has a requirement in Appendix 5?", "No requirement listed → No", "N"); return ok(c, NON_REG); }
      const need = c.ask("nonEuReq", `Appendix 5 lists non-EU requirements (${Array.from(new Set(non)).join(", ")}). Does the destination have such a requirement?`); if (!need) return;
      if (need === "N") return ok(c, NON_REG);
    }
    return legalStep(c, "Appendix 5 (TSZ0001G x EU REACH Annex XVII)", annex17Hint(tsz));
  } },
  annex14: { id: "annex14", title: "No.14 Prohibited substance: EU REACH Annex XIV", page: 24, source: SRC7, run: (c) => {
    const tsz = c.a.__tsz ?? "";
    const sunset = Array.from(new Set(annex14Records.filter((r) => clean(r.values?.[1]) === tsz).map((r) => clean(r.values?.[3])).filter(Boolean)));
    const q = c.ask("sunset3m", `Is the IMDS data submission date at least 3 months before the sunset date? (Appendix 6, Annex XIV${sunset.length ? " sunset date: " + sunset.join(" / ") : ""})`); if (!q) return;
    if (q === "Y") return ok(c, "Before expiry date.");
    const t = c.below("thr", "Below 0.1wt%? (0.1wt% is OK)", 0.1); if (!t) return;
    if (t === "Y") return ok(c, BELOW);
    const inEu = c.ask("supplierEu", "Confirm supplier location: is the supplier in the EU?"); if (!inEu) return;
    if (inEu === "N") { const eu = c.eu(); if (!eu) return; if (eu === "N") return ok(c, NON_REG); }
    return supplierStep(c, () => c.out("OK", "Change over will be confirmed.", 'Flow result: Judge OK — "Change over will be confirmed." Report the P/N and supplier information to TMC first (also TME/TMNA/TMA; TME has a special operation).'));
  } },
  benzidineAzo: { id: "benzidineAzo", title: "No.14 Benzidine and its salts / Azodyes that can form carcinogenic amines", page: 25, source: SRC7, run: (c) => {
    const name = c.a.__tszName ?? "";
    const isBenz = /benzidine/i.test(name);
    const benz = name ? c.auto('Substance group name is "Benzidine and its salts, all members"?', `${name.slice(0, 60)} → ${isBenz ? "Yes" : "No"}`, isBenz ? "Y" : "N")
      : c.ask("benzidine", 'Is the substance group name "Benzidine and its salts, all members"?');
    if (!benz) return;
    if (benz === "Y") return supplierStep(c, () => contactTmc(c, "Supplier confirms benzidine is contained."));
    const isAzo = name ? /azo ?dye/i.test(name) : true;
    const azo = c.auto('Substance group name is "Azodyes that can form carcinogenic amines, selected"?', name ? `${name.slice(0, 60)} → ${isAzo ? "Yes" : "No"}` : "CAS is in the azodye list (Ver.5.1.10 pp.76–86) → Yes", isAzo ? "Y" : "N");
    if (azo === "N") return contactTmc(c, "Neither the benzidine nor the azodye group.");
    const eu = c.eu(); if (!eu) return;
    if (eu === "N") return ok(c, NOT_PROHIBIT);
    const skin = c.ask("textileSkin", "Is it textile that touches the skin, or a fabric article? (e.g. Seat, Floormat)"); if (!skin) return;
    return skin === "Y" ? ng(c, CONTAINED) : ok(c, NOT_PROHIBIT);
  } },
  hcb: { id: "hcb", title: "No.14 Prohibited substance: HCB", page: 26, source: SRC7, run: (c) => {
    const i = c.ask("intent", "Confirm to supplier", INTENT); if (!i) return;
    if (i === "B") return ng(c, CONTAINED);
    const jp = c.ask("supplierJp", "Confirm supplier location: is the supplier in Japan?"); if (!jp) return;
    return jp === "N" ? ok(c, NON_REG) : c.out("OK", NOT_PROHIBIT, `Flow result: Judge OK — "${NOT_PROHIBIT}" Report the P/N and supplier information to TMC first.`);
  } },
  hfc: { id: "hfc", title: "No.14 Prohibited substance: Hydrofluorocarbons (HFC's), saturated", page: 27, source: SRC7, run: (c) => {
    const ac = c.textYes("airCon", 'Is the Component Part name or Delivery Part name an "AIR CONDITIONER"?', c.parts, /air ?con/i); if (!ac) return;
    if (ac === "N") return supplierStep(c, () => contactTmc(c, "Supplier confirms HFC is contained outside an air conditioner."));
    const ref = c.textYes("refrigerant", 'Is the Component Part "REFRIGERANT"?', c.f.componentPartName, /refrigerant/i); if (!ref) return;
    return ref === "Y" ? ok(c, NOT_PROHIBIT) : c.out("HOLD", "", "Air conditioner part, but the component is not the refrigerant: the Ver.7 chart has no branch for this. Judge manually.");
  } },
  pfoa: { id: "pfoa", title: "No.14 Prohibited substance: PFOA", page: 28, source: SRC7, run: (c) => {
    const s = c.ask("supplier", "Confirm to supplier", SUPPLIER_AB); if (!s) return;
    if (s === "A") return ng(c, MISTAKE);
    const d = c.dest(); if (!d) return;
    if (d === "EU") {
      const n = Number(String(c.f.substanceContentPct).replace(",", "."));
      const tot = c.f.substanceContentPct && Number.isFinite(n) && n >= 0.0000025
        ? c.auto("Is the total of PFOAs below 0.0000025wt% (25ppb) in the material?", `${c.f.substanceContentPct}% of one PFOA already reaches 25ppb → No`, "N")
        : c.ask("pfoaTotal", "Is the total of PFOAs below 0.0000025wt% (25ppb) in the material?");
      if (!tot) return;
      return tot === "Y" ? ok(c, "Below 0.0000025wt% (25ppb)") : ng(c, CONTAINED);
    }
    const jp = d === "JP" ? c.auto("Supplier located in Japan, or vehicle destination Japan?", "Destination JP → Yes", "Y") : c.ask("supplierJp", "Confirm supplier location: is the supplier in Japan?");
    if (!jp) return;
    if (jp === "Y") return contactTmc(c, "PFOA with a Japan supplier or a Japan destination.");
    const i = c.ask("intent", "Confirm to supplier", INTENT); if (!i) return;
    return i === "A" ? ok(c, NOT_PROHIBIT) : c.out("NG", CONTAINED, `Flow result: Judge NG — "${CONTAINED}" Contact TMC/TMNA/TMA/TME.`);
  } },
  phthalate: { id: "phthalate", title: "No.14 Prohibited substance: Phthalate", page: 29, source: SRC7, run: (c) => {
    const four = ["85-68-7", "117-81-7", "84-74-2", "84-69-5"].includes(c.f.cas);
    const t = c.below("thr", "Is the substance content below 0.1wt%?", 0.1); if (!t) return;
    if (t === "Y") {
      if (!four) return ok(c, "Below 0.1wt%.");
      const total = c.ask("total", "Is the total content of the four CAS (85-68-7, 117-81-7, 84-74-2, 84-69-5) in the same material below 0.1wt%?"); if (!total) return;
      if (total === "Y") return ok(c, "Below 0.1wt%.");
    }
    return supplierStep(c, () => contactTmc(c, "Supplier confirms the phthalate is contained at or above 0.1wt%."));
  } },
  pcb: { id: "pcb", title: "No.14 Prohibited substance: PCB", page: 30, source: SRC7, run: (c) => {
    const i = c.ask("intent", "Confirm to supplier", INTENT); if (!i) return;
    if (i === "B") return ng(c, CONTAINED);
    const eu = c.eu(); if (!eu) return;
    if (eu === "Y") { const t = c.below("thr", "Is PCB percentage below 0.0002wt% (2ppm)?", 0.0002, true); if (!t) return; return t === "Y" ? ok(c, "Below 0.0002wt%.") : ng(c, CONTAINED); }
    const jp = c.ask("supplierJp", "Confirm supplier location: is the supplier in Japan?"); if (!jp) return;
    return jp === "N" ? ok(c, NON_REG) : c.out("OK", NOT_PROHIBIT, `Flow result: Judge OK — "${NOT_PROHIBIT}" Report the P/N and supplier information to TMC first.`);
  } },
  perchlorate: { id: "perchlorate", title: "No.14 Prohibited substance: Perchlorate", page: 31, source: SRC7, run: (c) => {
    const na = c.northAmerica(); if (!na) return;
    if (na === "N") return ok(c, NON_REG);
    // The chart asks about the material name itself, so a material name in the row answers both ways.
    const isPurPvc = /\bPUR\b|polyurethane|\bPVC\b|polyvinyl ?chloride/i.test(c.f.materialName);
    const mat = c.f.materialName ? c.auto('Is the material name "PUR" or "PVC"?', `${c.f.materialName} from the row → ${isPurPvc ? "Yes" : "No"}`, isPurPvc ? "Y" : "N") : c.ask("purPvc", 'Is the material name "PUR" or "PVC"?'); if (!mat) return;
    if (mat === "Y") {
      const nu = c.ask("newUse", "Confirm to supplier: is the material a new use?"); if (!nu) return;
      return nu === "Y" ? contactTmc(c, "New use of perchlorate in PUR/PVC.") : ok(c, "Not new adoption of this substance");
    }
    const use = c.textYes("perchlorateUse", "Is the Delivery/Component part a Seat Belt Pretensioner, Airbag Initiator, Coin Battery, Pop up hood or Active roll bar?", c.parts, /pretension|air ?bag|initiator|coin batt|pop ?up hood|roll ?bar/i); if (!use) return;
    return use === "Y" ? ok(c, NOT_PROHIBIT) : c.out("NG", CONTAINED, `Flow result: Judge NG — "${CONTAINED}" If unclear, contact TMNA, TME, TMA, TMC.`);
  } },
  pyrrolidones: { id: "pyrrolidones", title: "No.14 Prohibited substance: Pyrrolidones, selected (CAS 872-50-4)", page: 32, source: SRC7, run: (c) => {
    const t = c.below("thr", "Substance content is below 0.3wt%? (0.3wt% is OK)", 0.3); if (!t) return;
    if (t === "Y") return ok(c, BELOW);
    const eu = c.eu(); if (!eu) return;
    if (eu === "N") return ok(c, NON_REG);
    const m = c.ask("mfgOutsideEu", "Is the product manufactured outside the EU?"); if (!m) return;
    if (m === "Y") return ok(c, "Only non-Regulated manufacturing location.");
    return supplierStep(c, () => {
      const u = c.ask("annexEntry71", "Confirm to supplier: is it an acceptable use per REACH Annex XVII Entry 71?"); if (!u) return;
      return u === "Y" ? ok(c, NOT_PROHIBIT) : contactTmc(c, "Use is not acceptable under Annex XVII Entry 71.");
    });
  } },
  dbt: { id: "dbt", title: "No.16 Prohibited substance (DBT)", page: 33, source: SRC7, run: (c) => {
    const eu = c.eu(); if (!eu) return;
    if (eu === "N") return ok(c, NON_REG);
    const cls = /^6\.[12]/.test(c.f.matlClass) ? c.auto("IMDS Matl. Class is 6.1 / 6.2?", `${c.f.matlClass} from the row → Yes`, "Y") : c.f.matlClass ? c.auto("IMDS Matl. Class is 6.1 / 6.2?", `${c.f.matlClass} from the row → No`, "N") : c.ask("matlClass", "Is IMDS Matl. Class 6.1 / 6.2?");
    if (!cls) return;
    if (cls === "Y") return ok(c, BELOW);
    const coat = c.textYes("lacquer", "Is the material name LACQUER / Ink coat / E-Coat / Adhesive?", c.f.materialName, /lacquer|ink coat|e-?coat|adhesive/i); if (!coat) return;
    if (coat === "Y") return ok(c, BELOW);
    const t = c.below("thr", "Is DBT percentage in the integral part of the article below 0.1%?", 0.1); if (!t) return;
    return t === "Y" ? ok(c, BELOW) : ng(c, CONTAINED);
  } },
  dot: { id: "dot", title: "No.17 Prohibited substance (DOT)", page: 34, source: SRC7, run: (c) => {
    const eu = c.eu(); if (!eu) return;
    if (eu === "N") return ok(c, NON_REG);
    const cls = /^6\.[12]/.test(c.f.matlClass) ? c.auto("IMDS Matl. Class is 6.1 / 6.2?", `${c.f.matlClass} from the row → Yes`, "Y") : c.f.matlClass ? c.auto("IMDS Matl. Class is 6.1 / 6.2?", `${c.f.matlClass} from the row → No`, "N") : c.ask("matlClass", "Is IMDS Matl. Class 6.1 / 6.2?");
    if (!cls) return;
    if (cls === "Y") return ok(c, BELOW);
    const lac = c.textYes("lacquer", "Is the material name LACQUER?", c.f.materialName, /lacquer/i); if (!lac) return;
    if (lac === "Y") return ok(c, BELOW);
    const t = c.below("thr", "Is DOT percentage in the integral part of the article below 0.1%?", 0.1); if (!t) return;
    if (t === "Y") return ok(c, BELOW);
    const skin = c.ask("textileSkin", "Is it textile that touches the skin, or a fabric article? (e.g. Seat, Floormat)"); if (!skin) return;
    return skin === "Y" ? ng(c, CONTAINED) : ok(c, NOT_PROHIBIT);
  } },
  sccp: { id: "sccp", title: "No.18 Prohibited substance (SCCP)", page: 36, source: SRC7, run: (c) => {
    if (c.f.cas === "85422-92-0") {
      // Paraffin oil: Ver.5.1.10 p.58 special case, not repeated in Ver.7.
      const o = c.ask("sccpOil", "Confirm to supplier: does the Paraffin Oil contain Cl Paraffin(s) SCCP (C10-13)?"); if (!o) return;
      if (o === "N") return ok(c, "Not containing prohibited substances.");
    }
    const s = c.ask("supplier", "Confirm to supplier immediately: is it an input mistake?", [["A", "A · It contains"], ["B", "B · Input mistake"]]); if (!s) return;
    if (s === "B") return ng(c, MISTAKE);
    const eu = c.eu(); if (!eu) return;
    if (eu === "N") return reportTmc(c, "SCCP is contained and the destination is not EU.");
    const t = c.below("thr", "Is SCCP below 0.15%? (0.15% is NG)", 0.15, true); if (!t) return;
    if (t === "Y") return ok(c, BELOW);
    return c.out("NG", CONTAINED, `Flow result: Judge NG — "${CONTAINED}" Report the P/N and supplier information immediately to TME/TMNA/TMA and TMC.`);
  } },
  mccp: { id: "mccp", title: "No.19 Prohibited substance (MCCP)", page: 37, source: MCCP_SOURCE, draft: true,
    caution: "Regulatory countries (EU, JP) come from the MCCP draft deck; Appendix 4 has no MCCP row yet. A person confirms — the system never finalises it.",
    run: (c) => {
      const d = c.dest("Vehicle destination (MCCP regulatory countries per Appendix 4, as of 2026 May: EU, JP)"); if (!d) return;
      if (!MCCP_REGULATED.has(d)) return ok(c, NON_REG);
      const s = c.ask("supplier", "Confirm to supplier immediately: is it an input mistake?", [["A", "A · Input mistake"], ["B", "B · It contains (chlorination rate 45% or more)"]]); if (!s) return;
      if (s === "A") return ng(c, MISTAKE);
      return reportTmc(c, "Supplier confirms MCCP is contained (chlorination rate 45% or more) for a regulated destination.");
    } },
  pb71: { id: "pb71", title: "No.10 ELV (Pb) · Application Code 71 flow", page: 18, source: SRC7, run: (c) => {
    const alu = /^2\.1\.[12]\b/.test(c.f.matlClass) ? c.auto("Material is aluminum? (IMDS Matl. Class 2.1.1 / 2.1.2)", `${c.f.matlClass} from the row → Yes`, "Y")
      : c.f.matlClass ? c.auto("Material is aluminum? (IMDS Matl. Class 2.1.1 / 2.1.2)", `${c.f.matlClass} from the row → No`, "N")
      : c.ask("aluminium", "Is the material aluminum (IMDS Matl. Class 2.1.1 / 2.1.2)?");
    if (!alu) return;
    if (alu === "N") return ng(c, "Improper Application ID selected.");
    const t = c.below("thr", "Is Pb 0.4wt% or below?", 0.4); if (!t) return;
    if (t === "N") return ng(c, CONTAINED);
    const m = c.ask("machining", "Confirm to supplier: is the aluminum material lead-containing for machining purposes?"); if (!m) return;
    if (m === "N") return contactTmc(c, "Supplier says the aluminum is not lead-containing for machining purposes.");
    const d = c.dest("Vehicle destination (the exemption ends in the EU 2028-01 and in TW 2030-01)"); if (!d) return;
    const today = c.today();
    if ((d === "EU" && today >= "2028-01-01") || (d === "TW" && today >= "2030-01-01")) return contactTmc(c, `The exemption for ${d} ends on ${d === "EU" ? "2028-01" : "2030-01"} and today is ${today}.`);
    return ok(c, "The substance is within exemption.");
  } },

  // ---------- Ver.5.1.10 charts not repeated in Ver.7 ----------
  methanol: { id: "methanol", title: "No.14 Methanol", page: 49, run: (c) => {
    const k = c.ask("methanolCase1", 'Is there a combination of Component Part name and Delivery Part name listed as "Methanol - case 1"?'); if (!k) return;
    if (k === "Y") return ok(c, NOT_PROHIBIT);
    const w = c.ask("wwf", "Is the Delivery Part or Component Part windshield washer fluid?"); if (!w) return;
    return w === "N" ? ok(c, NOT_PROHIBIT) : contactTmc(c, "Methanol in windshield washer fluid is regulated in some destinations.");
  } },
  pfas190: { id: "pfas190", title: "GADSL No.190 · PFAS / fluoropolymer (not listed in G-CATS procedure or TSZ0001G group)", page: null, source: "Precedent (not in the G-CATS manual)", run: (c) => {
    const carpet = /carpet/i.test(c.f.deliveryPartName + " " + c.f.componentPartName) ? c.ask("usCarpet", "The part is a carpet. Is the vehicle bound for the U.S.? (intentional use is prohibited for U.S. carpets)") : c.auto("Part name is a carpet?", "No (from the part names)", "N");
    if (!carpet) return;
    if (carpet === "Y") return contactTmc(c, "Carpet for a U.S. vehicle: intentional use is prohibited (TSZ0001G No.86).");
    const s = c.ask("supplier", "Confirm to supplier", [["A", "A · Substance remains in the final product"], ["B", "B · Input mistake / no longer used"]]); if (!s) return;
    return s === "A" ? ok(c, "Confirmed by supplier: Substance remain in final product.") : ng(c, `Supplier's input mistake. Substance ${c.f.cas || ""} is no longer used.`.replace("  ", " "));
  } }
};

type T1Flow = { id: string; title: string; page: number; limit: number; cas: string[] };
const T1_CAS = new Map<string, string>();
for (const f of (t1 as { flows: T1Flow[] }).flows) {
  DEFS[f.id] = { id: f.id, title: `No.14 ${f.title}`, page: f.page, run: (c) => {
    const t = c.below("thr", `Is the substance content below ${f.limit}wt%? (${f.limit}wt% is OK)`, f.limit); if (!t) return;
    if (t === "Y") return ok(c, BELOW);
    const eu = c.eu(); if (!eu) return;
    if (eu === "N") return ok(c, NON_REG);
    return supplierStep(c, () => contactTmc(c, "Supplier confirms the substance is contained and the destination is EU."));
  } };
  for (const cas of f.cas) if (!T1_CAS.has(cas)) T1_CAS.set(cas, f.id);
}

const fam = families as { families: Record<string, { label: string; page: number }>; cas: Record<string, string> };
/** CAS family (Ver.5.1.10 pp.76–86) → flow id when the flow has another name. */
const FAMILY_FLOW: Record<string, string> = { "benzidine-azo": "benzidineAzo", "cl-paraffins": "sccp" };

type Sel = { def: Def | null; id: string; title: string; page: number | null };
const pick = (id: string): Sel => ({ def: DEFS[id], id, title: DEFS[id].title, page: DEFS[id].page });

/** Which flow chart applies to this row. */
export function selectFlow(errorType: string, cas: string, hasTszGroup: boolean, tszNumber: string, tszFlow: string, hasGadsl190: boolean): Sel {
  const t = errorType.toLowerCase();
  if (/elv\s*\(\s*cd\s*\)/.test(t)) return pick("elvCd");
  if (/elv\s*\(\s*hg\s*\)/.test(t)) return pick("elvHg");
  if (/elv\s*\(\s*cr/.test(t)) return pick("elvCr");
  if (/\bmccp\b|medium[- ]chain chlorinated/.test(t)) return pick("mccp");
  if (/\(dot\)/.test(t)) return pick("dot");
  if (/\(dbt\)/.test(t)) return pick("dbt");
  if (/\(sccp\)|cl paraffin/.test(t) || fam.cas[cas] === "cl-paraffins" || cas === "85422-92-0") return pick("sccp");
  if (/arsenic/.test(t)) return { def: null, id: "arsenic", title: "No.15 Prohibited substance (Arsenic)", page: 55 };
  const t1id = T1_CAS.get(cas);
  if (t1id) return pick(t1id);
  const f = fam.cas[cas];
  const fid = f ? FAMILY_FLOW[f] ?? f : "";
  if (fid && DEFS[fid]) return pick(fid);
  const flow = tszFlow.toLowerCase();
  if (/hydrofluorocarbon/.test(flow)) return pick("hfc");
  if (/perchlorate/.test(flow)) return pick("perchlorate");
  if (f) return { def: null, id: f, title: "No.14 " + fam.families[f].label, page: fam.families[f].page };
  if (hasGadsl190 && !hasTszGroup) return pick("pfas190");
  if (tszNumber && /annex xvii\b/.test(flow)) return pick("annex17");
  if (tszNumber && /annex xiv\b/.test(flow)) return pick("annex14");
  if (tszNumber && /^pops/.test(flow)) return pick("pops");
  return { def: null, id: "none", title: "No dedicated flow found", page: null };
}

export function runFlow(sel: Sel, facts: RowFacts, answers: Record<string, string>, tszNumber: string, tszName = ""): FlowRun {
  if (!sel.def) return { flowId: sel.id, title: sel.title, page: sel.page, implemented: false, trail: [], next: null, outcome: null, source: SRC5, draft: false };
  const c = new Ctx(facts, { ...answers, __tsz: tszNumber, __tszName: tszName });
  const outcome = sel.def.run(c) ?? null;
  return { flowId: sel.id, title: sel.title, page: sel.page, implemented: true, trail: c.trail, next: outcome ? null : c.next, outcome,
    source: sel.def.source || SRC5, draft: Boolean(sel.def.draft), ...(sel.def.caution ? { caution: sel.def.caution } : {}) };
}
export const FLOW_SOURCE = SRC7;
export function pb71Run(facts: RowFacts, answers: Record<string, string>): FlowRun {
  return runFlow(pick("pb71"), facts, answers, "");
}
/** ELV Cd / Hg / Cr6+ (Ver.7 No.11–13). */
export function elvRun(errorType: string, facts: RowFacts, answers: Record<string, string>): FlowRun {
  return runFlow(selectFlow(errorType, "", false, "", "", false), facts, answers, "");
}
