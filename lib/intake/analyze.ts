import { detectColumns, casCells, numberText, FIELD_LABEL, type Detection, type Field } from "@/lib/intake/detect";
import { partKey, supplierKey } from "@/lib/intake/keys";
import { detectKind, runAutoWorkflow, type AutoOutput } from "@/lib/judgement/auto";
import { TOYOTA_OWNED, DESTINATION_OPTIONS, type FlowQuestion } from "@/lib/judgement/flows";
import { lookupSubstance } from "@/lib/reference-data";
import { checkWarp } from "@/lib/judgement/warp";
import type { RowFacts } from "@/lib/judgement/row-facts";

export type RowState = "OK" | "NG" | "ASK" | "DEPENDS" | "HOLD" | "INVALID";
export type Ask = { id: string; text: string; options: Array<[string, string]> };
export type AnalyzedRow = {
  r: number; key: string; partNo: string; supplierCode: string; cas: string; family: "substance" | "pb" | "mass" | "sms" | "app44" | "warp" | "other";
  /** The G-CATS error this line is likely to raise when submitted ("" = none expected). */
  predicted?: string;
  /** What a DEPENDS result depends on; both are applied by Toyota, never asked to the supplier. */
  dependsOn?: "destination" | "class";
  errorType: string; flowId: string; flowTitle: string; state: RowState; comment: string; reason: string;
  byDest?: Record<string, "OK" | "NG" | "HOLD">; ask: Ask[]; answered: Record<string, string>; issues: string[];
};
export type SupplierIdentity = { code: string; inMaster: boolean; masterName: string | null; parts: number; fromAccount: boolean };
export type Identity = { suppliers: SupplierIdentity[]; parts: number; substanceLines: number; massLines: number; predicted: Array<{ errorType: string; items: number }> };
export type Analysis = { detection: Detection; rows: AnalyzedRow[]; counts: Record<RowState, number>; truncated: boolean; fileKinds: string[]; identity: Identity };
export type AnswerMap = Record<string, Record<string, string>>;

const MAX_ROWS = 5000;
const CLASSES = ["MA", "MB", "MC", "MD", "ME", "MF"];
const rowKey = (partNo: string, family: string, cas: string) => `${partKey(partNo)}|${family}|${cas}`;

function blankFacts(): RowFacts {
  return { cas: "", substanceName: "", substanceContentPct: "", applicationId: "", materialName: "", matlClass: "", componentPartName: "", deliveryPartName: "", imdsMass: "", drawingMass: "", toleranceClass: "", drawingRefs: [], drawingStatus: "", companyName: "" };
}
const asAsk = (q: FlowQuestion): Ask => ({ id: q.id, text: q.text, options: q.options });
/** CAS numbers G-CATS checks under their own ELV error type. */
export const ELV_BY_CAS: Record<string, string> = { "7439-92-1": "ELV (Pb)", "7440-43-9": "ELV (Cd)", "7439-97-6": "ELV (Hg)", "18540-29-9": "ELV (Cr6+)" };
/** A CAS on none of Toyota's lists (GADSL 2026 V1, TSZ0001G Appendix 3) raises no prohibited-substance error. */
export const onToyotaLists = (cas: string) => { const l = lookupSubstance(cas); return l.gadsl.length > 0 || l.tszGroups.length > 0; };

function evaluate(errorType: string, facts: RowFacts, answers: Record<string, string>, fallbackKind: "substance" | "mass" | "pb"): Omit<AnalyzedRow, "r" | "key" | "partNo" | "supplierCode" | "cas" | "errorType" | "issues" | "answered"> {
  const kind = errorType ? detectKind(errorType) : fallbackKind === "mass" ? "mass" : "substance";
  const et = errorType || (kind === "mass" ? "Mass tolerance range" : "Prohibited substance");
  const base = { flowId: "", flowTitle: "", comment: "", reason: "", ask: [] as Ask[] };

  if (kind === "mass") {
    // The tolerance class comes from Toyota's drawing (Toyota-owned, never asked). A class in the file is a preview only.
    // Without one, every class is tried: if any class puts the mass outside the buffer, the supplier can answer A/B up front.
    const title = "Mass tolerance (TSZ2900G)";
    const sc = answers.supplierConfirmation;
    const classes = facts.toleranceClass ? [facts.toleranceClass] : CLASSES;
    const by: Record<string, "OK" | "NG" | "HOLD"> = {};
    let needSupplier = false; let sample: AutoOutput | null = null;
    for (const cls of classes) {
      const out = runAutoWorkflow({ errorType: et, facts: { ...facts, toleranceClass: cls }, toleranceClass: cls, supplierConfirmation: sc || undefined });
      sample ??= out;
      if (out.needs.supplierConfirmation && !sc) { needSupplier = true; by[cls] = "HOLD"; } else by[cls] = out.recommendation.state;
    }
    const predicted = Object.values(by).some((v) => v !== "OK") || needSupplier ? "Mass tolerance range" : "";
    if (needSupplier) return { ...base, family: "mass", flowId: "mass", flowTitle: title, state: "ASK", predicted, dependsOn: "class", byDest: by,
      reason: facts.toleranceClass ? sample!.recommendation.reason : "Toyota applies the tolerance class from the drawing. With some classes your mass is outside the tolerance.",
      ask: [{ id: "supplierConfirmation", text: facts.toleranceClass ? "The mass is outside the ±10% buffer. Which applies?" : "If Toyota finds the mass outside the drawing tolerance, which applies?", options: [["ACTUAL_OR_CALCULATED_MASS", "A · Actual / calculated mass"], ["INPUT_MISTAKE", "B · Input mistake"]] }] };
    const states = Array.from(new Set(Object.values(by)));
    if (states.length === 1) return { ...base, family: "mass", flowId: "mass", flowTitle: title, state: states[0], predicted, comment: sample!.recommendation.comment, reason: sample!.recommendation.reason, byDest: by, dependsOn: "class" };
    return { ...base, family: "mass", flowId: "mass", flowTitle: title, state: "DEPENDS", predicted, dependsOn: "class", byDest: by, reason: "The result depends on the drawing's tolerance class, which Toyota applies." };
  }

  if (kind === "sms" || kind === "app44") {
    const title = kind === "sms" ? "SMS Mass" : "Application44ERROR (No.24)";
    const opts: Array<[string, string]> = kind === "sms" ? [["ACTUAL_OR_CALCULATED_MASS", "A · Actual / calculated mass"], ["INPUT_MISTAKE", "B · Input mistake"]] : [["SUPPLIER_CONFIRMED", "A · I confirm the application / code"], ["INPUT_MISTAKE", "B · Input mistake"]];
    if (!answers.supplierConfirmation) return { ...base, family: kind, flowId: kind, flowTitle: title, state: "ASK", predicted: et, reason: "A supplier confirmation decides this one.", ask: [{ id: "supplierConfirmation", text: "Confirm to supplier", options: opts }] };
    const out = runAutoWorkflow({ errorType: et, facts, supplierConfirmation: answers.supplierConfirmation });
    return { ...base, family: kind, flowId: kind, flowTitle: title, state: out.recommendation.state, predicted: et, comment: out.recommendation.comment, reason: out.recommendation.reason };
  }
  if (kind === "pb" && facts.applicationId.trim() === "71") return { ...scenario("pb", et, facts, answers), predicted: et };
  if (kind === "pb") {
    const byDest: Record<string, "OK" | "NG" | "HOLD"> = {};
    let first: AutoOutput | null = null;
    for (const [d] of DESTINATION_OPTIONS) {
      const o = runAutoWorkflow({ errorType: et, facts, destination: d });
      byDest[d] = o.recommendation.state; first ??= o;
    }
    return { ...summariseByDestination("pb", "Pb TOYOTA Policy Table", byDest, first!), predicted: et };
  }

  // ELV Cd / Hg / Cr6+ (Ver.7 No.11–13): same supplier questions as substances, stored per CAS.
  if (kind === "elv") return { ...scenario("substance", et, facts, answers), predicted: et };
  if (kind === "substance") {
    if (!errorType && facts.cas && !onToyotaLists(facts.cas)) return { ...base, family: "substance", state: "OK", predicted: "", reason: "Not on GADSL 2026 V1 or TSZ0001G Appendix 3, so no prohibited-substance error is expected." };
    return { ...scenario("substance", et, facts, answers), predicted: et };
  }
  return { ...base, family: "other", state: "HOLD", reason: "This Error Type is handled by Toyota; nothing to self-check here." };
}

function scenario(family: "substance" | "pb", et: string, facts: RowFacts, answers: Record<string, string>): Omit<AnalyzedRow, "r" | "key" | "partNo" | "supplierCode" | "cas" | "errorType" | "issues" | "answered"> {
  const base = { flowId: "", flowTitle: "", comment: "", reason: "", ask: [] as Ask[] };
    const run = (dest: string) => runAutoWorkflow({ errorType: et, facts, destination: dest, answers });
    const eu = run("EU"), non = run("KR");
    const flowId = eu.flow?.flowId ?? "", flowTitle = eu.flow?.title ?? "Prohibited substance";
    if (eu.flow && !eu.flow.implemented) return { ...base, family, flowId, flowTitle, state: "HOLD", reason: `${eu.recommendation.reason} Toyota will complete this one.` };
    if (!eu.flow) return { ...base, family, flowId, flowTitle, state: "HOLD", reason: eu.recommendation.reason };
    const asks: Ask[] = [];
    for (const o of [eu, non]) { const q = o.flow?.next; if (q && !TOYOTA_OWNED.has(q.id) && !asks.some((a) => a.id === q.id)) asks.push(asAsk(q)); }
    if (asks.length) return { ...base, family, flowId, flowTitle, state: "ASK", reason: "A supplier confirmation decides this one.", ask: asks, byDest: { EU: eu.recommendation.state, KR: non.recommendation.state }, dependsOn: "destination" };
    const byDest = { EU: eu.recommendation.state, KR: non.recommendation.state };
    return summariseByDestination(family, flowTitle, byDest, eu, flowId);
}

function summariseByDestination(family: "pb" | "substance", title: string, byDest: Record<string, "OK" | "NG" | "HOLD">, sample: AutoOutput, flowId: string = family): Omit<AnalyzedRow, "r" | "key" | "partNo" | "supplierCode" | "cas" | "errorType" | "issues" | "answered"> {
  const states = Array.from(new Set(Object.values(byDest)));
  if (states.length === 1) return { family, flowId, flowTitle: title, state: states[0], comment: sample.recommendation.comment, reason: sample.recommendation.reason, ask: [], byDest };
  if (states.includes("HOLD") && states.length === 1) return { family, flowId, flowTitle: title, state: "HOLD", comment: "", reason: sample.recommendation.reason, ask: [], byDest };
  return { family, flowId, flowTitle: title, state: "DEPENDS", comment: "", reason: "The result depends on the vehicle destination, which Toyota applies.", ask: [], byDest, dependsOn: "destination" };
}

export function analyzeMatrix(matrix: string[][], opts: { mapping?: Partial<Record<Field, number>>; headerRow?: number | null; answers?: AnswerMap; accountSupplierCode?: string | null } = {}): Analysis {
  const det = detectColumns(matrix);
  if (opts.mapping) { det.mapping = opts.mapping; det.headerRow = opts.headerRow === undefined ? det.headerRow : opts.headerRow; det.dataStart = det.headerRow === null ? 0 : det.headerRow + 1; det.needsConfirm = false; det.confidence = 1; }
  const m = det.mapping;
  const get = (row: string[], f: Field) => (m[f] === undefined ? "" : row[m[f]!] ?? "");
  const ppm = m.contentPct !== undefined && /ppm/i.test(matrix[det.headerRow ?? 0]?.[m.contentPct] ?? "");
  const out: AnalyzedRow[] = [];
  const cache = new Map<string, ReturnType<typeof evaluate>>();
  let truncated = false;
  const data = matrix.slice(det.dataStart);
  const fileKinds = new Set<string>();
  for (let i = 0; i < data.length; i++) {
    if (out.length >= MAX_ROWS) { truncated = true; break; }
    const row = data[i]; const r = det.dataStart + i + 1;
    if (!row.some((c) => c)) continue;
    const issues: string[] = [];
    const partNo = get(row, "partNo"), supplierCode = get(row, "supplierCode");
    if (m.partNo !== undefined && !partNo) issues.push("Part No. is empty.");
    const errorType = get(row, "errorType");
    const rawCas = get(row, "cas");
    const hasMass = m.imdsMass !== undefined && (m.drawingMass !== undefined || m.toleranceClass !== undefined);
    // A row with masses but no CAS is a mass line even when the sheet also has a CAS column (mixed files).
    const rowHasMass = hasMass && Boolean(get(row, "imdsMass").trim()) && Boolean((get(row, "drawingMass") || get(row, "toleranceClass")).trim());
    const fallback: "substance" | "mass" | "pb" = rawCas ? "substance" : rowHasMass ? "mass" : m.cas !== undefined ? "substance" : hasMass ? "mass" : "pb";
    const kindHere = errorType ? detectKind(errorType) : fallback;
    const facts = blankFacts();
    facts.substanceName = get(row, "substanceName"); facts.materialName = get(row, "materialName"); facts.matlClass = get(row, "matlClass");
    facts.componentPartName = get(row, "componentPartName"); facts.deliveryPartName = get(row, "partName"); facts.applicationId = get(row, "applicationId");
    const content = get(row, "contentPct"); facts.substanceContentPct = content ? numberText(content, ppm) : "";
    if (content && !facts.substanceContentPct) issues.push(`Content “${content}” is not a number.`);
    facts.imdsMass = numberText(get(row, "imdsMass")); facts.drawingMass = numberText(get(row, "drawingMass"));
    const cls = get(row, "toleranceClass").toUpperCase(); facts.toleranceClass = CLASSES.includes(cls) ? cls : "";
    if (get(row, "imdsMass") && !facts.imdsMass) issues.push(`IMDS mass “${get(row, "imdsMass")}” is not a number.`);

    const casList: string[] = [];
    if (kindHere === "substance" || kindHere === "pb") {
      if (kindHere === "substance") {
        const parsed = casCells(rawCas);
        casList.push(...parsed.cas); if (parsed.issue) issues.push(parsed.issue);
        if (!parsed.cas.length) {
          out.push({ r, key: "", partNo, supplierCode, cas: rawCas, family: "substance", errorType, flowId: "", flowTitle: "", state: "INVALID", comment: "", reason: issues[0] || "CAS number is missing.", ask: [], answered: {}, issues });
          fileKinds.add("substance"); continue;
        }
      }
    }
    const targets = kindHere === "substance" ? casList : [""];
    for (const cas of targets) {
      const f2 = { ...facts, cas };
      // Without an Error Type column (a supplier's own IMDS data) the CAS decides which G-CATS check applies.
      const etHere = errorType || (cas ? ELV_BY_CAS[cas] ?? "" : "");
      const kHere = etHere ? detectKind(etHere) : kindHere;
      const family = kHere === "elv" ? "substance" : kHere === "substance" || kHere === "pb" || kHere === "mass" || kHere === "sms" || kHere === "app44" ? kHere : "other";
      const key = rowKey(partNo, family, family === "substance" ? cas : "");
      const answers = opts.answers?.[key] ?? {};
      const sig = JSON.stringify([etHere, f2, answers, fallback]);
      let ev = cache.get(sig);
      if (!ev) { ev = evaluate(etHere, f2, answers, fallback); cache.set(sig, ev); }
      fileKinds.add(ev.family);
      if (family === "pb" && !f2.applicationId) { out.push({ r, key, partNo, supplierCode, cas, errorType: etHere, ...ev, state: "HOLD", reason: "Application ID is missing in the file.", issues, answered: answers }); continue; }
      out.push({ r, key, partNo, supplierCode, cas, errorType: etHere, ...ev, issues: issues.slice(), answered: answers });
    }
  }
  // WARP Part number (No.21): a supplier code missing from Toyota's Purchasing master makes G-CATS flag every part.
  // The supplier can confirm the code up front; Toyota still checks with Purchasing when the code is correct.
  const accountCode = (opts.accountSupplierCode || "").trim();
  const partsByCode = new Map<string, Set<string>>();
  for (const row of out) {
    const code = (row.supplierCode || accountCode).trim();
    if (!code || !row.partNo) continue;
    (partsByCode.get(code) ?? partsByCode.set(code, new Set()).get(code)!).add(row.partNo);
  }
  const suppliers: SupplierIdentity[] = [];
  for (const [code, parts] of partsByCode) {
    const w = checkWarp(code, null);
    suppliers.push({ code, inMaster: w.found, masterName: w.found ? w.masterName : null, parts: parts.size, fromAccount: !out.some((x) => x.supplierCode.trim() === code) });
    if (w.found) continue;
    for (const partNo of parts) {
      const key = rowKey(partNo, "warp", "");
      const answered = opts.answers?.[key] ?? {};
      const a = answered.supplierCodeOk;
      const base = { r: 0, key, partNo, supplierCode: code, cas: "", family: "warp" as const, errorType: "WARP Part number", predicted: "WARP Part number", flowId: "warp21", flowTitle: "No.21 WARP Part number", comment: "", ask: [] as Ask[], answered, issues: [] as string[] };
      if (a === "Y") out.push({ ...base, state: "HOLD", reason: `Supplier code ${code} is not in Toyota's Purchasing master. You confirmed it is correct; Toyota checks it with Purchasing.` });
      else if (a === "N") out.push({ ...base, state: "NG", comment: "Supplier code is incorrect.", reason: `Correct the supplier code in IMDS and resubmit.` });
      else out.push({ ...base, state: "ASK", reason: `Supplier code ${code} is not in Toyota's Purchasing supplier master, so G-CATS will flag “WARP Part number”.`,
        ask: [{ id: "supplierCodeOk", text: `Is supplier code ${code} the correct code for these parts?`, options: [["Y", "Yes · the code is correct"], ["N", "No · I will correct it in IMDS"]] }] });
    }
  }
  const counts: Record<RowState, number> = { OK: 0, NG: 0, ASK: 0, DEPENDS: 0, HOLD: 0, INVALID: 0 };
  for (const row of out) counts[row.state]++;
  const predicted = new Map<string, number>();
  for (const row of out) if (row.predicted) predicted.set(row.predicted, (predicted.get(row.predicted) || 0) + 1);
  const identity: Identity = {
    suppliers, parts: new Set(out.map((x) => x.partNo).filter(Boolean)).size,
    substanceLines: out.filter((x) => x.family === "substance" || x.family === "pb").length, massLines: out.filter((x) => x.family === "mass" || x.family === "sms").length,
    predicted: [...predicted.entries()].sort((a, b) => b[1] - a[1]).map(([errorType, items]) => ({ errorType, items }))
  };
  return { detection: det, rows: out, counts, truncated, fileKinds: Array.from(fileKinds), identity };
}
export { FIELD_LABEL, partKey, supplierKey };
