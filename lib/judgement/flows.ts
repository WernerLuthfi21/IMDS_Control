import families from "@/data/reference/gcats-v5110-cas-families.json";
import { annex17Records } from "@/lib/reference-data";
import type { RowFacts } from "@/lib/judgement/row-facts";

/**
 * Executable versions of the G-CATS judgment Ver.5.1.10 Appendix II flow charts (No.14–18).
 * Each flow walks the chart using what the source row already says (content %, material, part name)
 * and asks only for what the row cannot know (destination, supplier answers, list lookups).
 * Results are recommendations; the human decides and saves.
 */
export type FlowQuestion = { id: string; text: string; options: Array<[string, string]> };
export type FlowOutcome = { state: "OK" | "NG" | "HOLD"; comment: string; reason: string };
export type FlowRun = {
  flowId: string; title: string; page: number | null; implemented: boolean;
  trail: Array<{ question: string; answer: string; auto: boolean }>;
  next: FlowQuestion | null; outcome: FlowOutcome | null;
};
export const DESTINATION_OPTIONS: Array<[string, string]> = [["EU", "EU"], ["KR", "KR"], ["CN", "CN"], ["TW", "TW"], ["IN", "IN"], ["JP", "JP"], ["OTH", "Other"]];
const YN: Array<[string, string]> = [["Y", "Yes"], ["N", "No"]];
const SRC = "G-CATS judgment Ver.5.1.10, Appendix II";

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
  /** Destination → "EU destination?" (Y/N). */
  eu(): "Y" | "N" | undefined {
    const d = this.ask("destination", "Vehicle destination", DESTINATION_OPTIONS);
    return d === undefined ? undefined : d === "EU" ? "Y" : "N";
  }
  /** Is the substance content at or below `limit` wt%? Uses the row's content when present. */
  below(id: string, text: string, limit: number): "Y" | "N" | undefined {
    const n = Number(String(this.f.substanceContentPct).replace(",", "."));
    if (this.f.substanceContentPct && Number.isFinite(n)) return this.auto(text, `${this.f.substanceContentPct}% from the row → ${n <= limit ? "Yes" : "No"}`, n <= limit ? "Y" : "N") as "Y" | "N";
    return this.ask(id, text) as "Y" | "N" | undefined;
  }
  out(state: FlowOutcome["state"], comment: string, reason: string): FlowOutcome { return { state, comment, reason }; }
}

type Def = { id: string; title: string; page: number | null; run: (c: Ctx) => FlowOutcome | undefined };
const ok = (c: Ctx, comment: string) => c.out("OK", comment, `Flow result: Judge OK — "${comment}"`);
const ng = (c: Ctx, comment: string) => c.out("NG", comment, `Flow result: Judge NG — "${comment}"`);
const contactTmc = (c: Ctx, why: string) => c.out("HOLD", "", `${why} Contact TMC/TMNA/TME/TDEM; do not judge yet.`);
const BELOW = "The substance is below threshold.";
const NON_REG = "Only non-Regulated destination.";
const CONTAINED = "Prohibited substance(s) is contained.";

const DEFS: Record<string, Def> = {
  pyrrolidones: { id: "pyrrolidones", title: "No.14 Pyrrolidones, selected (CAS 872-50-4)", page: 53, run: (c) => {
    const t = c.below("thr", "Substance content is below 0.3wt%? (0.3wt% is OK)", 0.3); if (!t) return;
    if (t === "Y") return ok(c, BELOW);
    const eu = c.eu(); if (!eu) return;
    if (eu === "N") return ok(c, NON_REG);
    const m = c.ask("mfgOutsideEu", "Is the product manufactured outside the EU?"); if (!m) return;
    if (m === "Y") return ok(c, "Only non-Regulated manufacturing location.");
    const s = c.ask("supplier", "Confirm to supplier", [["A", "A · Input mistake"], ["B", "B · It contains"]]); if (!s) return;
    if (s === "A") return ng(c, "Supplier input mistake.");
    const u = c.ask("annexEntry71", "Is it an acceptable use per REACH Annex XVII Entry 71?"); if (!u) return;
    return u === "Y" ? ok(c, "Use is not prohibit.") : contactTmc(c, "Use is not acceptable under Annex XVII Entry 71.");
  } },
  dot: { id: "dot", title: "No.17 Prohibited substance (DOT)", page: 57, run: (c) => {
    const eu = c.eu(); if (!eu) return;
    if (eu === "N") return ok(c, NON_REG);
    const cls = /^6\.[12]/.test(c.f.matlClass) ? c.auto("IMDS Matl. Class is 6.1 / 6.2?", `${c.f.matlClass} from the row → Yes`, "Y") : c.f.matlClass ? c.auto("IMDS Matl. Class is 6.1 / 6.2?", `${c.f.matlClass} from the row → No`, "N") : c.ask("matlClass", "Is IMDS Matl. Class 6.1 / 6.2?");
    if (!cls) return;
    if (cls === "Y") return ok(c, BELOW);
    const lac = /lacquer/i.test(c.f.materialName) ? c.auto("Material name is LACQUER?", `${c.f.materialName} from the row → Yes`, "Y") : c.ask("lacquer", "Is the material name LACQUER?");
    if (!lac) return;
    if (lac === "Y") return ok(c, BELOW);
    const t = c.below("thr", "Is DOT percentage in the integral part of the article below 0.1%?", 0.1); if (!t) return;
    if (t === "Y") return ok(c, BELOW);
    const skin = c.ask("textileSkin", "Is it textile that touches the skin, or a fabric article? (e.g. Seat, Floormat)"); if (!skin) return;
    return skin === "Y" ? ng(c, CONTAINED) : ok(c, "Use is not prohibit.");
  } },
  dbt: { id: "dbt", title: "No.16 Prohibited substance (DBT)", page: 56, run: (c) => {
    const eu = c.eu(); if (!eu) return;
    if (eu === "N") return ok(c, NON_REG);
    const cls = /^6\.[12]/.test(c.f.matlClass) ? c.auto("IMDS Matl. Class is 6.1 / 6.2?", `${c.f.matlClass} from the row → Yes`, "Y") : c.f.matlClass ? c.auto("IMDS Matl. Class is 6.1 / 6.2?", `${c.f.matlClass} from the row → No`, "N") : c.ask("matlClass", "Is IMDS Matl. Class 6.1 / 6.2?");
    if (!cls) return;
    if (cls === "Y") return ok(c, BELOW);
    const coat = /lacquer|ink coat|e-?coat|adhesive/i.test(c.f.materialName) ? c.auto("Material name is LACQUER / Ink coat / E-Coat / Adhesive?", `${c.f.materialName} from the row → Yes`, "Y") : c.ask("lacquer", "Is the material name LACQUER / Ink coat / E-Coat / Adhesive?");
    if (!coat) return;
    if (coat === "Y") return ok(c, BELOW);
    const t = c.below("thr", "Is DBT percentage in the integral part of the article below 0.1%?", 0.1); if (!t) return;
    return t === "Y" ? ok(c, BELOW) : ng(c, CONTAINED);
  } },
  hcb: { id: "hcb", title: "No.14 HCB (hexachlorobenzene)", page: 36, run: (c) => popsFlow(c, 0.001, "0.001wt%") },
  pcb: { id: "pcb", title: "No.14 PCB (polychlorinated biphenyls)", page: 42, run: (c) => popsFlow(c, 0.0002, "0.0002wt%") },
  phthalate: { id: "phthalate", title: "No.14 Phthalates, selected", page: 40, run: (c) => {
    const four = ["85-68-7", "117-81-7", "84-74-2", "84-69-5"].includes(c.f.cas);
    const t = c.below("thr", "Is the substance content below 0.1wt%?", 0.1); if (!t) return;
    if (t === "Y") {
      if (four) { const total = c.ask("total", "Is the total content of the four CAS (85-68-7, 117-81-7, 84-74-2, 84-69-5) in the same material below 0.1wt%?"); if (!total) return; if (total === "Y") return ok(c, "Below 0.1wt%."); }
      else return ok(c, "Below 0.1wt%.");
    }
    const s = c.ask("supplier", "Confirm to supplier", [["A", "A · Input mistake"], ["B", "B · It contains"]]); if (!s) return;
    return s === "A" ? ng(c, "Supplier input mistake.") : contactTmc(c, "Supplier confirms the phthalate is contained at or above 0.1wt%.");
  } },
  methanol: { id: "methanol", title: "No.14 Methanol", page: 49, run: (c) => {
    const k = c.ask("methanolCase1", 'Is there a combination of Component Part name and Delivery Part name listed as "Methanol - case 1"?'); if (!k) return;
    if (k === "Y") return ok(c, "Use is not prohibit.");
    const w = c.ask("wwf", "Is the Delivery Part or Component Part windshield washer fluid?"); if (!w) return;
    return w === "N" ? ok(c, "Use is not prohibit.") : contactTmc(c, "Methanol in windshield washer fluid is regulated in some destinations.");
  } },
  pfas190: { id: "pfas190", title: "GADSL No.190 · PFAS / fluoropolymer (not listed in G-CATS procedure or TSZ0001G group)", page: null, run: (c) => {
    const carpet = /carpet/i.test(c.f.deliveryPartName + " " + c.f.componentPartName) ? c.ask("usCarpet", "The part is a carpet. Is the vehicle bound for the U.S.? (intentional use is prohibited for U.S. carpets)") : c.auto("Part name is a carpet?", "No (from the part names)", "N");
    if (!carpet) return;
    if (carpet === "Y") return contactTmc(c, "Carpet for a U.S. vehicle: intentional use is prohibited (TSZ0001G No.86).");
    const s = c.ask("supplier", "Confirm to supplier", [["A", "A · Substance remains in the final product"], ["B", "B · Input mistake / no longer used"]]); if (!s) return;
    return s === "A" ? ok(c, "Confirmed by supplier: Substance remain in final product.") : ng(c, `Supplier's input mistake. Substance ${c.f.cas || ""} is no longer used.`.replace("  ", " "));
  } },
  annex17: { id: "annex17", title: "EU REACH Annex XVII substance judge flow (Appendix 3 → Appendix 5)", page: null, run: (c) => {
    const eu = c.eu(); if (!eu) return;
    if (eu === "Y") return c.out("HOLD", "", "EU destination: judge against the Annex XVII entry conditions listed in Appendix 5 (item for judge). That entry-specific step is not encoded.");
    const tsz = c.a.__tsz ?? "";
    const non = annex17Records.filter((r) => String(r.values?.[1] ?? "").trim() === tsz).map((r) => String(r.values?.[7] ?? "").replace(/_x000D_/g, " ").trim()).filter(Boolean);
    if (!non.length) return ok(c, NON_REG);
    const need = c.ask("nonEuReq", `Appendix 5 lists non-EU requirements (${Array.from(new Set(non)).join(", ")}). Does the destination have such a requirement?`); if (!need) return;
    return need === "N" ? ok(c, NON_REG) : c.out("HOLD", "", "Non-EU destination has a requirement listed in Appendix 5; judge manually.");
  } }
};

function popsFlow(c: Ctx, limit: number, label: string): FlowOutcome | undefined {
  const i = c.ask("intent", "Confirm to supplier", [["A", "A · Non-intentional use"], ["B", "B · Intentional use"]]); if (!i) return;
  if (i === "B") return ng(c, CONTAINED);
  const eu = c.eu(); if (!eu) return;
  if (eu === "Y") { const t = c.below("thr", `Is the percentage below ${label}?`, limit); if (!t) return; return t === "Y" ? ok(c, `Below ${label}.`) : ng(c, CONTAINED); }
  const jp = c.ask("supplierJp", "Is the supplier located in Japan?"); if (!jp) return;
  return jp === "N" ? ok(c, NON_REG) : c.out("OK", "Use is not prohibit.", 'Flow result: Judge OK — "Use is not prohibit." Report the P/N and supplier information to TMC first.');
}

const fam = families as { families: Record<string, { label: string; page: number }>; cas: Record<string, string> };

/** Which Appendix II flow applies to this row. */
export function selectFlow(errorType: string, cas: string, hasTszGroup: boolean, tszNumber: string, tszFlow: string, hasGadsl190: boolean): { def: Def | null; id: string; title: string; page: number | null } {
  const t = errorType.toLowerCase();
  if (/\(dot\)/.test(t)) return { def: DEFS.dot, id: "dot", title: DEFS.dot.title, page: 57 };
  if (/\(dbt\)/.test(t)) return { def: DEFS.dbt, id: "dbt", title: DEFS.dbt.title, page: 56 };
  if (/\(sccp\)|cl paraffin/.test(t)) return { def: null, id: "cl-paraffins", title: "No.18 Prohibited substance (Cl Paraffins)", page: 58 };
  if (/arsenic/.test(t)) return { def: null, id: "arsenic", title: "No.15 Prohibited substance (Arsenic)", page: 55 };
  const f = fam.cas[cas];
  if (f && DEFS[f]) return { def: DEFS[f], id: f, title: DEFS[f].title, page: DEFS[f].page };
  if (f) return { def: null, id: f, title: "No.14 " + fam.families[f].label, page: fam.families[f].page };
  if (hasGadsl190 && !hasTszGroup) return { def: DEFS.pfas190, id: "pfas190", title: DEFS.pfas190.title, page: null };
  if (/annex xvii/i.test(tszFlow) && tszNumber) return { def: DEFS.annex17, id: "annex17", title: DEFS.annex17.title, page: null };
  return { def: null, id: "none", title: "No dedicated flow found", page: null };
}

export function runFlow(sel: ReturnType<typeof selectFlow>, facts: RowFacts, answers: Record<string, string>, tszNumber: string): FlowRun {
  if (!sel.def) return { flowId: sel.id, title: sel.title, page: sel.page, implemented: false, trail: [], next: null, outcome: null };
  const c = new Ctx(facts, { ...answers, __tsz: tszNumber });
  const outcome = sel.def.run(c) ?? null;
  return { flowId: sel.id, title: sel.title, page: sel.page, implemented: true, trail: c.trail, next: outcome ? null : c.next, outcome };
}
export const FLOW_SOURCE = SRC;
