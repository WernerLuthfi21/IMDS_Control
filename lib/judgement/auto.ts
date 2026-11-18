import Decimal from "decimal.js";
import { selectFlow, runFlow, pb71Run, elvRun, type FlowRun } from "@/lib/judgement/flows";
import { evaluateJudgement, type JudgementInput } from "@/lib/judgement/engine";
import { isValidCas, lookupSubstance, lookupSubstanceByName, normalizeCas } from "@/lib/reference-data";
import { lookupPbPolicy, PB_SOURCE } from "@/lib/judgement/pb-policy";
import type { RowFacts } from "@/lib/judgement/row-facts";
import type { JudgementResult } from "@/lib/types";
import { checkWarp, isWarpError, WARP_SOURCE } from "@/lib/judgement/warp";

export type StepStatus = "DONE" | "NEEDS_INPUT" | "MANUAL" | "INFO";
export type AutoStep = { id: string; title: string; status: StepStatus; detail: string };
export type AutoRecommendation = { state: "OK" | "NG" | "HOLD"; comment: string; reason: string };
export type AutoInput = { errorType: string; facts: RowFacts; supplierCode?: string | null; destination?: string; toleranceClass?: string; supplierConfirmation?: string; answers?: Record<string, string> };
export type AutoOutput = {
  kind: "mass" | "sms" | "app44" | "pb" | "elv" | "substance" | "warp" | "manual";
  steps: AutoStep[];
  procedureText: string;
  recommendation: AutoRecommendation;
  flow?: FlowRun | null;
  needs: { destination: boolean; toleranceClass: boolean; supplierConfirmation: boolean };
  massBands: Record<string, unknown> | null;
  engineInput: JudgementInput;
  engine: Pick<JudgementResult, "ruleId" | "ruleStatus" | "recommendation" | "reason">;
};

const firstLine = (v: unknown) => String(v ?? "").replace(/_x000D_/g, " ").split(/\n/)[0].trim();

export function detectKind(errorType: string): AutoOutput["kind"] {
  const t = errorType.toLowerCase();
  if (isWarpError(errorType)) return "warp";
  if (/mass tolerance|tolerance range|error.?type.?7/.test(t)) return "mass";
  if (/^(sms mass|6)$/.test(t.trim())) return "sms";
  if (/application\s*44\s*error/.test(t) || /^24$/.test(t.trim())) return "app44";
  if (/elv\s*\(pb\)/.test(t)) return "pb";
  if (/elv\s*\(\s*(cd|hg|cr)/.test(t)) return "elv";
  if (/prohibited|restricted|regulated substance/.test(t)) return "substance";
  if (/^(?:(?:error\s*type|no\.?)\s*)?1[4-8](?:\.0)?(?:\b|$)/.test(t.trim())) return "substance";
  return "manual";
}

function toRecommendation(r: JudgementResult): AutoRecommendation {
  if (r.recommendation === "RECOMMEND_OK") return { state: "OK", comment: r.comment || "", reason: r.reason };
  if (r.recommendation === "RECOMMEND_NG") return { state: "NG", comment: r.comment || "", reason: r.reason };
  return { state: "HOLD", comment: "", reason: r.reason };
}

function substanceSteps(facts: RowFacts) {
  const steps: AutoStep[] = [];
  const rawCas = String(facts.cas || "");
  const casMatches = [...rawCas.matchAll(/\b\d{2,7}\s*[-‐‑‒–—]\s*\d{2}\s*[-‐‑‒–—]\s*\d\b/g)]
    .map((match) => normalizeCas(match[0])).filter((value) => isValidCas(value));
  let cas = casMatches.length === 1 ? casMatches[0] : normalizeCas(rawCas);
  let nameResolved = false;
  if ((!cas || !isValidCas(cas)) && facts.substanceName) {
    const named = lookupSubstanceByName(facts.substanceName);
    if (named.casCandidates.length === 1) { cas = named.casCandidates[0]; nameResolved = true; }
    else {
      steps.push({
        id: "gadsl", title: "Search CAS / exact substance name in GADSL 2026 V1",
        status: "MANUAL",
        detail: named.casCandidates.length > 1
          ? "Exact substance-name match has " + named.casCandidates.length + " CAS candidates. Confirm the CAS from the source IMDS record; the system will not choose between them."
          : "CAS is missing or masked and no exact one-to-one substance-name match was found. Search the source reference manually."
      });
      steps.push({ id: "tsz", title: "Find TSZ0001G group in Appendix 3", status: "MANUAL", detail: "A unique CAS is required before the Appendix 3 and dedicated-flow lookup can be completed." });
      return { steps, gadslNo: "", tszText: "", flowName: "", lookup: null };
    }
  }
  if (casMatches.length > 1) {
    steps.push({ id: "gadsl", title: "Search CAS in GADSL 2026 V1", status: "MANUAL", detail: "The source row contains more than one valid CAS number. Resolve each substance as a separate case; no CAS is selected automatically." });
    steps.push({ id: "tsz", title: "Find TSZ0001G group in Appendix 3", status: "MANUAL", detail: "Multiple CAS values require a case-by-case reference lookup." });
    return { steps, gadslNo: "", tszText: "", flowName: "", lookup: null };
  }
  const lookup = cas && isValidCas(cas) ? lookupSubstance(cas) : null;
  let gadslNo = "", tszText = "", flowName = "";
  if (!cas || !lookup) {
    steps.push({ id: "gadsl", title: "Search CAS in GADSL 2026 V1", status: "MANUAL", detail: "CAS No. is blank or masked in the source row (Confidential Substances). Search by substance name manually." });
    steps.push({ id: "tsz", title: "Find TSZ0001G group in Appendix 3", status: "MANUAL", detail: "Needs a CAS number." });
    return { steps, gadslNo, tszText, flowName, lookup };
  }
  const g = lookup.gadsl;
  gadslNo = Array.from(new Set(g.map((r) => String(r.gadslNumber || r.referenceNumber || "").trim()).filter(Boolean))).slice(0, 4).join(", ");
  steps.push({
    id: "gadsl", title: "Search CAS in GADSL 2026 V1",
    status: g.length ? "DONE" : "INFO",
    detail: g.length
      ? `${cas}${nameResolved ? " (CAS resolved by exact substance name)" : ""} → GADSL No. ${gadslNo} · ${firstLine(g[0].substance)} · class ${g[0].classification}${g.length > 1 ? ` (+${g.length - 1} more entries)` : ""}`
      : `${cas} not found in GADSL 2026 V1${lookup.deletedGadslMatches.length ? " (found in the deleted-substance list)" : ""}.`
  });
  const t = lookup.tszGroups[0];
  if (t) {
    const no = String(t.values?.[1] ?? "").trim(), name = firstLine(t.values?.[2]);
    flowName = firstLine(t.values?.[4]);
    tszText = `${no} ${name}`.trim();
    steps.push({ id: "tsz", title: "Find TSZ0001G group in Appendix 3", status: "DONE", detail: `TSZ0001G #${no} · ${name} · judge flow: ${flowName || "—"}${lookup.tszMatchedBy === "group-name" ? " (\"all members\" group, matched by the GADSL substance name)" : ""}` });
  } else {
    steps.push({ id: "tsz", title: "Find TSZ0001G group in Appendix 3", status: "INFO", detail: `${cas} is not listed in Appendix 3. Use the GADSL entry and the substance-specific flow.` });
  }
  const bits: string[] = [];
  if (lookup.pops.length) bits.push(`POPs (${lookup.pops.length})`);
  if (lookup.reachAnnexXVII.length) bits.push(`REACH Annex XVII (${lookup.reachAnnexXVII.length})`);
  if (lookup.reachAnnexXIV.length) bits.push(`REACH Annex XIV (${lookup.reachAnnexXIV.length})`);
  steps.push({
    id: "flow", title: "Select POPs / REACH / dedicated flow",
    status: flowName || bits.length ? "DONE" : "INFO",
    detail: flowName ? `${flowName}${bits.length ? " · matches: " + bits.join(", ") : ""}` : bits.length ? `Matches: ${bits.join(", ")}` : "No POPs/REACH entry for this TSZ group."
  });
  return { steps, gadslNo, tszText, flowName, lookup };
}

function materialStep(facts: RowFacts): AutoStep {
  const parts = [facts.materialName && `Material: ${facts.materialName}`, facts.componentPartName && `Component: ${facts.componentPartName}`, facts.applicationId && `Application ID: ${facts.applicationId}`, facts.substanceContentPct && `Content: ${facts.substanceContentPct}%`].filter(Boolean);
  return { id: "use", title: "Verify material / use context", status: parts.length ? "DONE" : "MANUAL", detail: parts.length ? parts.join(" · ") : "No material or use data in the source row." };
}

function procedure(gadslNo: string, tszText: string, flowName: string, extra: string[] = []) {
  const lines: string[] = [];
  const a = [gadslNo && `GADSL: ${gadslNo}`, tszText && `TSZ0001G: ${tszText}`].filter(Boolean).join("; ");
  if (a) lines.push(`1) ${a}`);
  if (flowName) lines.push(`2) Appendix 3: ${flowName}`);
  return [...lines, ...extra].join("\n");
}

export function runAutoWorkflow(input: AutoInput): AutoOutput {
  const { facts } = input;
  const kind = detectKind(input.errorType);
  const needs = { destination: false, toleranceClass: false, supplierConfirmation: false };

  if (kind === "mass") {
    const cls = (input.toleranceClass || facts.toleranceClass || "").toUpperCase();
    // Manual Flow Ver.7 No.7: outside the tolerance and the Delivery Part name says "Raw Material"
    // (blank formed shape, forging or casting) → OK when the part is heavier than the drawing mass, else NG.
    const raw = /raw\s*material/i.test(facts.deliveryPartName);
    let heavier: boolean | undefined;
    try { if (raw && facts.imdsMass && facts.drawingMass) heavier = new Decimal(String(facts.imdsMass).replace(",", ".")).greaterThan(new Decimal(String(facts.drawingMass).replace(",", "."))); } catch { heavier = undefined; }
    const engineInput: JudgementInput = { errorType: input.errorType, imdsMass: facts.imdsMass || undefined, drawingMass: facts.drawingMass || undefined, toleranceClass: cls || undefined, supplierConfirmation: input.supplierConfirmation as JudgementInput["supplierConfirmation"],
      ...(raw ? { isRawMaterial: true, drawingHeavierThanReference: heavier } : {}) };
    const result = evaluateJudgement(engineInput);
    const trace = result.evaluations?.[0]?.inputValue;
    const bands = trace && typeof trace === "object" && "min" in (trace as object) ? (trace as Record<string, unknown>) : null;
    needs.toleranceClass = !cls;
    needs.supplierConfirmation = result.recommendation === "MANUAL_REVIEW" && Boolean(bands);
    const steps: AutoStep[] = [
      { id: "imds", title: "IMDS mass", status: facts.imdsMass ? "DONE" : "MANUAL", detail: facts.imdsMass ? `${facts.imdsMass} g (from the G-CATS row)` : "Missing in the source row." },
      { id: "drawing", title: "Drawing mass", status: facts.drawingMass ? "DONE" : "MANUAL", detail: facts.drawingMass ? `${facts.drawingMass} g (from the G-CATS row${facts.drawingRefs.length ? " · " + facts.drawingRefs.join(" / ") : ""})` : "Not in the source row. Read it from the drawing." },
      { id: "class", title: "Mass tolerance class", status: cls ? "DONE" : "NEEDS_INPUT", detail: cls ? `Class ${cls}${bands ? ` · ±${bands.tolerance} g (TSZ2900G Rev.9 row ${bands.tableRow})` : ""}` : "Read the class from the drawing and pick it (MA–MF). Everything else is automatic." },
      ...(bands ? [{ id: "bands", title: "TSZ2900 range", status: "DONE" as const, detail: `${bands.min}–${bands.max} g · with ±10% buffer ${bands.bufferMin}–${bands.bufferMax} g · band: ${String(bands.band).replaceAll("_", " ").toLowerCase()}` }] : []),
      ...(raw && result.evaluations?.[0]?.nodeId === "MASS-7-RAW" ? [{ id: "raw", title: "Raw material (Manual Flow Ver.7 No.7)", status: heavier === undefined ? "MANUAL" as const : "DONE" as const, detail: heavier === undefined ? "Delivery Part name says Raw Material; compare the IMDS mass with the drawing mass." : `Delivery Part name says Raw Material · IMDS mass ${facts.imdsMass} g is ${heavier ? "heavier" : "not heavier"} than the drawing mass ${facts.drawingMass} g.` }] : [])
    ];
    const rawProc = raw && result.evaluations?.[0]?.nodeId === "MASS-7-RAW" && heavier !== undefined ? `Mass tolerance (G-CATS Manual Flow Ver.7 No.7): outside the drawing tolerance; Delivery Part name says Raw Material; IMDS mass ${facts.imdsMass} g is ${heavier ? "heavier" : "not heavier"} than the drawing mass ${facts.drawingMass} g.` : "";
    const proc = rawProc ? rawProc : bands ? `Mass tolerance (TSZ2900G Rev.9): drawing ${bands.drawingMass} g, class ${bands.toleranceClass} ±${bands.tolerance} g → ${bands.min}–${bands.max} g (buffer ${bands.bufferMin}–${bands.bufferMax} g); IMDS mass ${bands.imdsMass} g is ${String(bands.band).replaceAll("_", " ").toLowerCase()}.` : "";
    return { kind, steps, procedureText: proc, recommendation: toRecommendation(result), needs, massBands: bands, engineInput, engine: pick(result) };
  }

  if (kind === "sms" || kind === "app44") {
    needs.supplierConfirmation = true;
    const engineInput: JudgementInput = { errorType: input.errorType, supplierConfirmation: input.supplierConfirmation as JudgementInput["supplierConfirmation"] };
    const result = evaluateJudgement(engineInput);
    return { kind, steps: [{ id: "supplier", title: "Supplier confirmation", status: input.supplierConfirmation ? "DONE" : "NEEDS_INPUT", detail: kind === "app44" ? "A = supplier confirms the application / code · B = input mistake." : "A = actual or calculated mass · B = input mistake." }], procedureText: input.supplierConfirmation ? `Supplier confirmation: ${input.supplierConfirmation === "INPUT_MISTAKE" ? "B input mistake" : kind === "app44" ? "A supplier confirms" : "A actual/calculated mass"}.` : "", recommendation: toRecommendation(result), needs, massBands: null, engineInput, engine: pick(result) };
  }

  if (kind === "elv") {
    const answers = { ...(input.answers || {}), ...(input.destination ? { destination: input.destination } : {}) };
    const fr = elvRun(input.errorType, facts, answers);
    const engineInput: JudgementInput = { errorType: input.errorType, applicationId: facts.applicationId || undefined, destination: input.destination || undefined };
    const result = evaluateJudgement(engineInput);
    const steps: AutoStep[] = [materialStep(facts)];
    for (const t of fr.trail) steps.push({ id: "q" + steps.length, title: t.question, status: "DONE", detail: t.answer + (t.auto ? " (auto)" : "") });
    if (fr.next) steps.push({ id: "next", title: fr.next.text, status: "NEEDS_INPUT", detail: "Pick an answer to continue the flow." });
    needs.destination = fr.next?.id === "destination";
    const recommendation: AutoRecommendation = fr.outcome ? { state: fr.outcome.state, comment: fr.outcome.comment, reason: fr.outcome.reason } : { state: "HOLD", comment: "", reason: "Answer the next flow question to get a recommendation." };
    const procedureText = fr.outcome ? `${fr.title} (${fr.source}, p.${fr.page}): ${fr.trail.map((t) => `${t.question} ${t.answer}`).join("; ")} → ${fr.outcome.state}.` : "";
    return { kind, steps, flow: fr, procedureText, recommendation, needs, massBands: null, engineInput, engine: pick(result) };
  }

  if (kind === "pb" || kind === "substance") {
    const sub = substanceSteps(facts);
    const steps = [...sub.steps];
    needs.destination = true;
    let recommendation: AutoRecommendation;
    let engineInput: JudgementInput = { errorType: input.errorType, applicationId: facts.applicationId || undefined, destination: input.destination || undefined };
    let result: JudgementResult;
    let flow: FlowRun | null = null;
    const extra: string[] = [];
    if (kind === "pb" && facts.applicationId.trim() === "71") {
      result = evaluateJudgement(engineInput);
      const fr = pb71Run(facts, { ...(input.answers || {}), ...(input.destination ? { destination: input.destination } : {}) });
      flow = fr;
      for (const t of fr.trail) steps.push({ id: "q" + steps.length, title: t.question, status: "DONE", detail: t.answer + (t.auto ? " (auto)" : "") });
      needs.destination = fr.next?.id === "destination";
      if (fr.next) steps.push({ id: "next", title: fr.next.text, status: "NEEDS_INPUT", detail: "Pick an answer to continue the flow." });
      recommendation = fr.outcome ? { state: fr.outcome.state, comment: fr.outcome.comment, reason: fr.outcome.reason } : { state: "HOLD", comment: "", reason: "Answer the next flow question to get a recommendation." };
      extra.push(`3) ${fr.title} (${fr.source}): ${fr.trail.map((t) => `${t.question} ${t.answer}`).join("; ")}${fr.outcome ? ` → ${fr.outcome.state}` : ""}.`);
    } else if (kind === "pb") {
      const pb = lookupPbPolicy(facts.applicationId, input.destination || "");
      if (pb.found) {
        engineInput = { ...engineInput, policyOutcome: pb.outcome === "HOLD" ? "UNKNOWN" : pb.outcome };
        steps.push({ id: "dest", title: "Destination → Pb TOYOTA Policy Table", status: pb.outcome === "HOLD" ? "MANUAL" : "DONE", detail: `Application ID ${pb.applicationId} · ${pb.destination} → ${pb.outcome === "HOLD" ? "needs manual check" : pb.outcome}${pb.note ? " · " + pb.note : ""} (${PB_SOURCE})` });
        extra.push(`3) Pb TOYOTA Policy Table: Application ID ${pb.applicationId}, destination ${pb.destination} → ${pb.outcome}.`);
      } else {
        steps.push({ id: "dest", title: "Destination → Pb TOYOTA Policy Table", status: "NEEDS_INPUT", detail: pb.reason });
      }
      result = evaluateJudgement(engineInput);
      recommendation = toRecommendation(result);
      if (recommendation.state === "OK" && !recommendation.comment) recommendation.comment = "The substance is within exemption.";
    } else {
      result = evaluateJudgement(engineInput);
      const g = sub.lookup?.gadsl ?? [];
      const has190 = g.some((r) => String(r.gadslNumber || r.referenceNumber || "").trim() === "190");
      const tszNo = String(sub.lookup?.tszGroups[0]?.values?.[1] ?? "").trim();
      const sel = selectFlow(input.errorType, normalizeCas(facts.cas || ""), Boolean(sub.lookup?.tszGroups[0]), tszNo, sub.flowName, has190);
      const answers = { ...(input.answers || {}), ...(input.destination ? { destination: input.destination } : {}) };
      const tszName = firstLine(sub.lookup?.tszGroups[0]?.values?.[2]);
      const fr = runFlow(sel, facts, answers, tszNo, tszName);
      flow = fr;
      const isType19 = /^\s*19\b/.test(input.errorType);
      if (!fr.implemented) {
        steps.push({ id: "flow2", title: `Dedicated flow: ${fr.title}`, status: "MANUAL", detail: fr.page ? `Not encoded yet. Follow ${fr.source}, PDF page ${fr.page}.` : "No dedicated flow found for this CAS/group. Judge manually." });
        needs.destination = false;
        recommendation = { state: "HOLD", comment: "", reason: `Steps 1–4 were done automatically. This flow (${fr.title}) is not encoded yet — judge OK/NG manually${fr.page ? ` using PDF page ${fr.page}` : ""}.` };
      } else {
        for (const t of fr.trail) steps.push({ id: "q" + steps.length, title: t.question, status: "DONE", detail: t.answer + (t.auto ? " (auto)" : "") });
        needs.destination = fr.next?.id === "destination";
        if (fr.next) steps.push({ id: "next", title: fr.next.text, status: "NEEDS_INPUT", detail: "Pick an answer to continue the flow." });
        recommendation = fr.outcome ? { state: fr.outcome.state, comment: fr.outcome.comment, reason: fr.outcome.reason } : { state: "HOLD", comment: "", reason: "Answer the next flow question to get a recommendation." };
        extra.push(`3) ${fr.title} (${fr.source}): ${fr.trail.map((t) => `${t.question} ${t.answer}`).join("; ")}${fr.outcome ? ` → ${fr.outcome.state}` : ""}.`);
      }
      if (isType19) recommendation = { state: "HOLD", comment: "", reason: "Numerical Error Type 19 is always HOLD pending process-owner reconciliation (Version 6 Section II / Appendix I conflict)." };
    }
    steps.push(materialStep(facts));
    return { kind, steps, flow, procedureText: procedure(sub.gadslNo, sub.tszText, sub.flowName, extra), recommendation, needs, massBands: null, engineInput, engine: pick(result) };
  }

  if (kind === "warp") {
    const engineInput: JudgementInput = { errorType: input.errorType };
    const result = evaluateJudgement(engineInput);
    const w = checkWarp(input.supplierCode, facts.companyName);
    const steps: AutoStep[] = [{ id: "warp-master", title: "Supplier code in Purchasing supplier code master", status: w.found && w.nameMatches !== false ? "DONE" : w.found ? "INFO" : "INFO", detail: `${w.reason} (${WARP_SOURCE})` }];
    const purchasing = input.answers?.purchasingWarp;
    let recommendation: AutoRecommendation;
    if (w.found && w.nameMatches !== false) {
      recommendation = { state: "OK", comment: "Confirmed by Purchasing Div.", reason: "Supplier code is registered in the Purchasing supplier code master (G-CATS Appendix I No.21)." };
    } else if (purchasing === "Y" || purchasing === "N") {
      steps.push({ id: "warp-purchasing", title: "Purchasing Div. confirmation", status: "DONE", detail: purchasing === "Y" ? "Purchasing confirmed the supplier code / WARP registration." : "Purchasing says the supplier code is incorrect." });
      recommendation = purchasing === "Y" ? { state: "OK", comment: "Confirmed by Purchasing Div.", reason: "Purchasing Div. confirmed the supplier code." } : { state: "NG", comment: "Supplier code is incorrect.", reason: "Purchasing Div. says the supplier code is incorrect." };
    } else {
      steps.push({ id: "warp-purchasing", title: "Purchasing Div. confirmation", status: "NEEDS_INPUT", detail: "Ask Purchasing whether the supplier code / WARP registration is correct." });
      recommendation = { state: "HOLD", comment: "", reason: "Purchasing Div. must confirm the supplier code (Appendix I No.21)." };
    }
    const flow: FlowRun = { flowId: "warp21", title: "No.21 WARP Part number", page: null, implemented: true, source: "G-CATS judgment Ver.5.1.10, Appendix I No.21", draft: false,
      trail: [{ question: "Supplier code in Purchasing master?", answer: w.found ? (w.nameMatches === false ? "Yes, name differs" : "Yes") : "No", auto: true }],
      next: recommendation.state === "HOLD" ? { id: "purchasingWarp", text: "Does Purchasing Div. confirm the supplier code / WARP registration?", options: [["Y", "Yes · confirmed"], ["N", "No · code incorrect"]] } : null,
      outcome: recommendation.state === "HOLD" ? null : { state: recommendation.state, comment: recommendation.comment, reason: recommendation.reason } };
    const procedureText = recommendation.state === "HOLD" ? "" : `No.21 WARP: ${w.reason}${purchasing ? ` Purchasing Div.: ${purchasing === "Y" ? "confirmed" : "code incorrect"}.` : ""}`;
    return { kind, steps, flow, procedureText, recommendation, needs: { destination: false, toleranceClass: false, supplierConfirmation: false }, massBands: null, engineInput, engine: pick(result) };
  }

  const engineInput: JudgementInput = { errorType: input.errorType };
  const result = evaluateJudgement(engineInput);
  return { kind, steps: [materialStep(facts)], procedureText: "", recommendation: toRecommendation(result), needs, massBands: null, engineInput, engine: pick(result) };
}

function pick(r: JudgementResult) { return { ruleId: r.ruleId, ruleStatus: r.ruleStatus, recommendation: r.recommendation, reason: r.reason }; }
