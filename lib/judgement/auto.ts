import { selectFlow, runFlow, pb71Run, FLOW_SOURCE, type FlowRun } from "@/lib/judgement/flows";
import { evaluateJudgement, type JudgementInput } from "@/lib/judgement/engine";
import { isValidCas, lookupSubstance, lookupSubstanceByName, normalizeCas } from "@/lib/reference-data";
import { lookupPbPolicy, PB_SOURCE } from "@/lib/judgement/pb-policy";
import type { RowFacts } from "@/lib/judgement/row-facts";
import type { JudgementResult } from "@/lib/types";

export type StepStatus = "DONE" | "NEEDS_INPUT" | "MANUAL" | "INFO";
export type AutoStep = { id: string; title: string; status: StepStatus; detail: string };
export type AutoRecommendation = { state: "OK" | "NG" | "HOLD"; comment: string; reason: string };
export type AutoInput = { errorType: string; facts: RowFacts; destination?: string; toleranceClass?: string; supplierConfirmation?: string; answers?: Record<string, string> };
export type AutoOutput = {
  kind: "mass" | "sms" | "app44" | "pb" | "substance" | "manual";
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
  if (/mass tolerance|tolerance range|error.?type.?7/.test(t)) return "mass";
  if (/^(sms mass|6)$/.test(t.trim())) return "sms";
  if (/application\s*44\s*error/.test(t) || /^24$/.test(t.trim())) return "app44";
  if (/elv\s*\(pb\)/.test(t)) return "pb";
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
          ? \`Exact substance-name match has \${named.casCandidates.length} CAS candidates. Confirm the CAS from the source IMDS record; the system will not choose between them.\`
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
      ? `${cas} → GADSL No. ${gadslNo} · ${firstLine(g[0].substance)} · class ${g[0].classification}${g.length > 1 ? ` (+${g.length - 1} more entries)` : ""}`
      : `${cas} not found in GADSL 2026 V1${lookup.deletedGadslMatches.length ? " (found in the deleted-substance list)" : ""}.`
  });
  const t = lookup.tszGroups[0];
  if (t) {
    const no = String(t.values?.[1] ?? "").trim(), name = firstLine(t.values?.[2]);
    flowName = firstLine(t.values?.[4]);
    tszText = `${no} ${name}`.trim();
    steps.push({ id: "tsz", title: "Find TSZ0001G group in Appendix 3", status: "DONE", detail: `TSZ0001G #${no} · ${name} · judge flow: ${flowName || "—"}` });
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
    const engineInput: JudgementInput = { errorType: input.errorType, imdsMass: facts.imdsMass || undefined, drawingMass: facts.drawingMass || undefined, toleranceClass: cls || undefined, supplierConfirmation: input.supplierConfirmation as JudgementInput["supplierConfirmation"] };
    const result = evaluateJudgement(engineInput);
    const trace = result.evaluations?.[0]?.inputValue;
    const bands = trace && typeof trace === "object" && "min" in (trace as object) ? (trace as Record<string, unknown>) : null;
    needs.toleranceClass = !cls;
    needs.supplierConfirmation = result.recommendation === "MANUAL_REVIEW" && Boolean(bands);
    const steps: AutoStep[] = [
      { id: "imds", title: "IMDS mass", status: facts.imdsMass ? "DONE" : "MANUAL", detail: facts.imdsMass ? `${facts.imdsMass} g (from the G-CATS row)` : "Missing in the source row." },
      { id: "drawing", title: "Drawing mass", status: facts.drawingMass ? "DONE" : "MANUAL", detail: facts.drawingMass ? `${facts.drawingMass} g (from the G-CATS row${facts.drawingRefs.length ? " · " + facts.drawingRefs.join(" / ") : ""})` : "Not in the source row. Read it from the drawing." },
      { id: "class", title: "Mass tolerance class", status: cls ? "DONE" : "NEEDS_INPUT", detail: cls ? `Class ${cls}${bands ? ` · ±${bands.tolerance} g (TSZ2900G Rev.9 row ${bands.tableRow})` : ""}` : "Read the class from the drawing and pick it (MA–MF). Everything else is automatic." },
      ...(bands ? [{ id: "bands", title: "TSZ2900 range", status: "DONE" as const, detail: `${bands.min}–${bands.max} g · with ±10% buffer ${bands.bufferMin}–${bands.bufferMax} g · band: ${String(bands.band).replaceAll("_", " ").toLowerCase()}` }] : [])
    ];
    const proc = bands ? `Mass tolerance (TSZ2900G Rev.9): drawing ${bands.drawingMass} g, class ${bands.toleranceClass} ±${bands.tolerance} g → ${bands.min}–${bands.max} g (buffer ${bands.bufferMin}–${bands.bufferMax} g); IMDS mass ${bands.imdsMass} g is ${String(bands.band).replaceAll("_", " ").toLowerCase()}.` : "";
    return { kind, steps, procedureText: proc, recommendation: toRecommendation(result), needs, massBands: bands, engineInput, engine: pick(result) };
  }

  if (kind === "sms" || kind === "app44") {
    needs.supplierConfirmation = true;
    const engineInput: JudgementInput = { errorType: input.errorType, supplierConfirmation: input.supplierConfirmation as JudgementInput["supplierConfirmation"] };
    const result = evaluateJudgement(engineInput);
    return { kind, steps: [{ id: "supplier", title: "Supplier confirmation", status: input.supplierConfirmation ? "DONE" : "NEEDS_INPUT", detail: kind === "app44" ? "A = supplier confirms the application / code · B = input mistake." : "A = actual or calculated mass · B = input mistake." }], procedureText: input.supplierConfirmation ? `Supplier confirmation: ${input.supplierConfirmation === "INPUT_MISTAKE" ? "B input mistake" : kind === "app44" ? "A supplier confirms" : "A actual/calculated mass"}.` : "", recommendation: toRecommendation(result), needs, massBands: null, engineInput, engine: pick(result) };
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
      extra.push(`3) ${fr.title} (${FLOW_SOURCE}): ${fr.trail.map((t) => `${t.question} ${t.answer}`).join("; ")}${fr.outcome ? ` → ${fr.outcome.state}` : ""}.`);
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
      const fr = runFlow(sel, facts, answers, tszNo);
      flow = fr;
      const isType19 = /^\s*19\b/.test(input.errorType);
      if (!fr.implemented) {
        steps.push({ id: "flow2", title: `Dedicated flow: ${fr.title}`, status: "MANUAL", detail: fr.page ? `Not encoded yet. Follow ${FLOW_SOURCE}, PDF page ${fr.page}.` : "No dedicated flow found for this CAS/group. Judge manually." });
        needs.destination = false;
        recommendation = { state: "HOLD", comment: "", reason: `Steps 1–4 were done automatically. This flow (${fr.title}) is not encoded yet — judge OK/NG manually${fr.page ? ` using PDF page ${fr.page}` : ""}.` };
      } else {
        for (const t of fr.trail) steps.push({ id: "q" + steps.length, title: t.question, status: "DONE", detail: t.answer + (t.auto ? " (auto)" : "") });
        needs.destination = fr.next?.id === "destination";
        if (fr.next) steps.push({ id: "next", title: fr.next.text, status: "NEEDS_INPUT", detail: "Pick an answer to continue the flow." });
        recommendation = fr.outcome ? { state: fr.outcome.state, comment: fr.outcome.comment, reason: fr.outcome.reason } : { state: "HOLD", comment: "", reason: "Answer the next flow question to get a recommendation." };
        extra.push(`3) ${fr.title} (${FLOW_SOURCE}): ${fr.trail.map((t) => `${t.question} ${t.answer}`).join("; ")}${fr.outcome ? ` → ${fr.outcome.state}` : ""}.`);
      }
      if (isType19) recommendation = { state: "HOLD", comment: "", reason: "Numerical Error Type 19 is always HOLD pending process-owner reconciliation (Version 6 Section II / Appendix I conflict)." };
    }
    steps.push(materialStep(facts));
    return { kind, steps, flow, procedureText: procedure(sub.gadslNo, sub.tszText, sub.flowName, extra), recommendation, needs, massBands: null, engineInput, engine: pick(result) };
  }

  const engineInput: JudgementInput = { errorType: input.errorType };
  const result = evaluateJudgement(engineInput);
  return { kind, steps: [materialStep(facts)], procedureText: "", recommendation: toRecommendation(result), needs, massBands: null, engineInput, engine: pick(result) };
}

function pick(r: JudgementResult) { return { ruleId: r.ruleId, ruleStatus: r.ruleStatus, recommendation: r.recommendation, reason: r.reason }; }
