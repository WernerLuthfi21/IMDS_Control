import { detectColumns, casCells, numberText, FIELD_LABEL, type Detection, type Field } from "@/lib/intake/detect";
import { partKey, supplierKey } from "@/lib/intake/keys";
import { detectKind, runAutoWorkflow, type AutoOutput } from "@/lib/judgement/auto";
import { TOYOTA_OWNED, DESTINATION_OPTIONS, type FlowQuestion } from "@/lib/judgement/flows";
import type { RowFacts } from "@/lib/judgement/row-facts";

export type RowState = "OK" | "NG" | "ASK" | "DEPENDS" | "HOLD" | "INVALID";
export type Ask = { id: string; text: string; options: Array<[string, string]> };
export type AnalyzedRow = {
  r: number; key: string; partNo: string; supplierCode: string; cas: string; family: "substance" | "pb" | "mass" | "other";
  errorType: string; flowId: string; flowTitle: string; state: RowState; comment: string; reason: string;
  byDest?: Record<string, "OK" | "NG" | "HOLD">; ask: Ask[]; answered: Record<string, string>; issues: string[];
};
export type Analysis = { detection: Detection; rows: AnalyzedRow[]; counts: Record<RowState, number>; truncated: boolean; fileKinds: string[] };
export type AnswerMap = Record<string, Record<string, string>>;

const MAX_ROWS = 5000;
const CLASSES = ["MA", "MB", "MC", "MD", "ME", "MF"];
const rowKey = (partNo: string, family: string, cas: string) => `${partKey(partNo)}|${family}|${cas}`;

function blankFacts(): RowFacts {
  return { cas: "", substanceName: "", substanceContentPct: "", applicationId: "", materialName: "", matlClass: "", componentPartName: "", deliveryPartName: "", imdsMass: "", drawingMass: "", toleranceClass: "", drawingRefs: [], drawingStatus: "" };
}
const asAsk = (q: FlowQuestion): Ask => ({ id: q.id, text: q.text, options: q.options });

function evaluate(errorType: string, facts: RowFacts, answers: Record<string, string>, fallbackKind: "substance" | "mass" | "pb"): Omit<AnalyzedRow, "r" | "key" | "partNo" | "supplierCode" | "cas" | "errorType" | "issues" | "answered"> {
  const kind = errorType ? detectKind(errorType) : fallbackKind === "mass" ? "mass" : "substance";
  const et = errorType || (kind === "mass" ? "Mass tolerance range" : "Prohibited substance");
  const base = { flowId: "", flowTitle: "", comment: "", reason: "", ask: [] as Ask[] };

  if (kind === "mass") {
    const cls = answers.toleranceClass || facts.toleranceClass;
    const out = runAutoWorkflow({ errorType: et, facts, toleranceClass: cls || undefined, supplierConfirmation: answers.supplierConfirmation || undefined });
    if (out.needs.toleranceClass && !cls) return { ...base, family: "mass", flowId: "mass", flowTitle: "Mass tolerance (TSZ2900G)", state: "ASK", reason: "Mass tolerance class is not in the file.", ask: [{ id: "toleranceClass", text: "Mass tolerance class on the drawing", options: CLASSES.map((c) => [c, c] as [string, string]) }] };
    if (out.needs.supplierConfirmation && !answers.supplierConfirmation) return { ...base, family: "mass", flowId: "mass", flowTitle: "Mass tolerance (TSZ2900G)", state: "ASK", reason: out.recommendation.reason, ask: [{ id: "supplierConfirmation", text: "Mass is outside the ±10% buffer. Which applies?", options: [["ACTUAL_OR_CALCULATED_MASS", "A · Actual / calculated mass"], ["INPUT_MISTAKE", "B · Input mistake"]] }] };
    return { ...base, family: "mass", flowId: "mass", flowTitle: "Mass tolerance (TSZ2900G)", state: out.recommendation.state === "HOLD" ? "HOLD" : out.recommendation.state, comment: out.recommendation.comment, reason: out.recommendation.reason };
  }

  if (kind === "pb") {
    const byDest: Record<string, "OK" | "NG" | "HOLD"> = {};
    let first: AutoOutput | null = null;
    for (const [d] of DESTINATION_OPTIONS) {
      const o = runAutoWorkflow({ errorType: et, facts, destination: d });
      byDest[d] = o.recommendation.state; first ??= o;
    }
    return summariseByDestination("pb", "Pb TOYOTA Policy Table", byDest, first!);
  }

  if (kind === "substance") {
    const run = (dest: string) => runAutoWorkflow({ errorType: et, facts, destination: dest, answers });
    const eu = run("EU"), non = run("KR");
    const flowId = eu.flow?.flowId ?? "", flowTitle = eu.flow?.title ?? "Prohibited substance";
    if (eu.flow && !eu.flow.implemented) return { ...base, family: "substance", flowId, flowTitle, state: "HOLD", reason: `${eu.recommendation.reason} Toyota will complete this one.` };
    if (!eu.flow) return { ...base, family: "substance", flowId, flowTitle, state: "HOLD", reason: eu.recommendation.reason };
    const asks: Ask[] = [];
    for (const o of [eu, non]) { const q = o.flow?.next; if (q && !TOYOTA_OWNED.has(q.id) && !asks.some((a) => a.id === q.id)) asks.push(asAsk(q)); }
    if (asks.length) return { ...base, family: "substance", flowId, flowTitle, state: "ASK", reason: "A supplier confirmation decides this one.", ask: asks, byDest: { EU: eu.recommendation.state, KR: non.recommendation.state } };
    const byDest = { EU: eu.recommendation.state, KR: non.recommendation.state };
    return summariseByDestination("substance", flowTitle, byDest, eu, flowId);
  }
  return { ...base, family: "other", state: "HOLD", reason: "This Error Type is handled by Toyota; nothing to self-check here." };
}

function summariseByDestination(family: "pb" | "substance", title: string, byDest: Record<string, "OK" | "NG" | "HOLD">, sample: AutoOutput, flowId: string = family): Omit<AnalyzedRow, "r" | "key" | "partNo" | "supplierCode" | "cas" | "errorType" | "issues" | "answered"> {
  const states = Array.from(new Set(Object.values(byDest)));
  if (states.length === 1) return { family, flowId, flowTitle: title, state: states[0], comment: sample.recommendation.comment, reason: sample.recommendation.reason, ask: [], byDest };
  if (states.includes("HOLD") && states.length === 1) return { family, flowId, flowTitle: title, state: "HOLD", comment: "", reason: sample.recommendation.reason, ask: [], byDest };
  return { family, flowId, flowTitle: title, state: "DEPENDS", comment: "", reason: "The result depends on the vehicle destination, which Toyota applies.", ask: [], byDest };
}

export function analyzeMatrix(matrix: string[][], opts: { mapping?: Partial<Record<Field, number>>; headerRow?: number | null; answers?: AnswerMap } = {}): Analysis {
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
    const fallback: "substance" | "mass" | "pb" = rawCas || m.cas !== undefined ? "substance" : hasMass ? "mass" : "pb";
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
      const family = kindHere === "substance" ? "substance" : kindHere === "pb" ? "pb" : kindHere === "mass" ? "mass" : "other";
      const key = rowKey(partNo, family, cas);
      const answers = opts.answers?.[key] ?? {};
      const sig = JSON.stringify([errorType, f2, answers, fallback]);
      let ev = cache.get(sig);
      if (!ev) { ev = evaluate(errorType, f2, answers, fallback); cache.set(sig, ev); }
      fileKinds.add(ev.family);
      if (family === "pb" && !f2.applicationId) { out.push({ r, key, partNo, supplierCode, cas, errorType, ...ev, state: "HOLD", reason: "Application ID is missing in the file.", issues, answered: answers }); continue; }
      out.push({ r, key, partNo, supplierCode, cas, errorType, ...ev, issues: issues.slice(), answered: answers });
    }
  }
  const counts: Record<RowState, number> = { OK: 0, NG: 0, ASK: 0, DEPENDS: 0, HOLD: 0, INVALID: 0 };
  for (const row of out) counts[row.state]++;
  return { detection: det, rows: out, counts, truncated, fileKinds: Array.from(fileKinds) };
}
export { FIELD_LABEL, partKey, supplierKey };
