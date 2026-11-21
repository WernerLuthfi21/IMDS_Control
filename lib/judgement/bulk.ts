import { isWorking } from "@/lib/judgement/piles";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runAutoWorkflow, detectKind, type AutoOutput } from "@/lib/judgement/auto";
import { extractRowFacts } from "@/lib/judgement/row-facts";
import { familyOfKind, loadConfirmation, loadConfirmationsFor, pickConfirmation, type StoredConfirmation } from "@/lib/intake/confirmations";
import { FOUR_PHTHALATES, fourPhthalateTotal } from "@/lib/judgement/material-group";
import { normalizeCas } from "@/lib/reference-data";
import type { PartMemory } from "@/lib/judgement/memory";
import { escalationKey, needsTmc, tmcRecommendation, type Escalation } from "@/lib/judgement/escalation";
import { classifyCase, evidenceOf, type ReviewCard } from "@/lib/judgement/review";

export type BulkSourceItem = {
  id: string; source_record_key: string; error_type_label: string;
  delivery_part_no: string | null; supplier_code: string | null;
  source_status: string | null; judge: string | null; raw_source: Record<string, unknown> | null;
};
export type BulkCandidate = {
  id: string; sourceRecordKey: string; errorType: string; partNo: string | null;
  supplierCode: string | null; cas: string; substanceName: string; kind: AutoOutput["kind"];
  recommendation: AutoOutput["recommendation"]; procedureText: string; signature: string;
  eligible: boolean; inPendingQueue: boolean; prohibited: boolean;
  /** The flow that decided this case is marked draft in its source: a person may confirm it, the system never finalises it. */
  draftFlow: boolean;
  caution?: string;
  prohibitedStatus: "CONNECTED" | "NEEDS_REVIEW" | "NOT_PROHIBITED"; reviewReason: string;
  /** Set when the flow says "Contact TMC": the case key and what Toyota answered so far. */
  tmc: { key: string; status: Escalation["status"]; answer: "OK" | "NG" | null } | null;
  /** What a person still has to give, as one flashcard. */
  card: ReviewCard;
  /** Questions the engine answered from the row or the masters, as "question — answer" (shown as evidence). */
  evidence?: string[];
};
function stable(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return "{" + Object.keys(record).sort().map((key) => JSON.stringify(key) + ":" + stable(record[key])).join(",") + "}";
  }
  return JSON.stringify(value) ?? "null";
}
/** Loaded once per request so evaluating a batch does not query the database per case. */
export type BulkContext = { confirmations?: StoredConfirmation[] | null; siblings?: Map<string, BulkSourceItem[]> };
export async function evaluateBulkCandidate(supabase: SupabaseClient, item: BulkSourceItem, memory?: PartMemory, escalations?: Map<string, Escalation>, ctx?: BulkContext): Promise<BulkCandidate> {
  const facts = extractRowFacts(item.raw_source);
  const kind = detectKind(item.error_type_label);
  const family = familyOfKind(kind);
  const casN = normalizeCas(facts.cas || "");
  const stored = !family ? null : ctx?.confirmations ? pickConfirmation(ctx.confirmations, item, family, casN) : await loadConfirmation(supabase, item, family, casN);
  if (FOUR_PHTHALATES.has(casN) && ctx?.siblings) {
    const sib = ctx.siblings.get(String(item.delivery_part_no ?? "").trim().toUpperCase()) ?? [];
    const sum = fourPhthalateTotal({ raw: item.raw_source, partNo: item.delivery_part_no, supplierCode: item.supplier_code },
      sib.filter((s) => s.id !== item.id).map((s) => ({ raw: s.raw_source, partNo: s.delivery_part_no, supplierCode: s.supplier_code })));
    if (sum) facts.fourPhthalateTotal = sum;
  }
  // Supplier answers first, then what Toyota already answered for this part (destination, class, Toyota-owned flow answers).
  const remembered: Record<string, string> = {};
  for (const [field, entry] of Object.entries(memory ?? {})) if (entry) remembered[field] = entry.value;
  const answers: Record<string, string> = { ...(stored?.answers ?? {}), ...remembered };
  const supplierConfirmation = typeof answers.supplierConfirmation === "string" ? answers.supplierConfirmation : undefined;
  const toleranceClass = facts.toleranceClass || (typeof answers.toleranceClass === "string" && /^M[A-F]$/.test(answers.toleranceClass) ? answers.toleranceClass : undefined);
  const destination = typeof answers.destination === "string" ? answers.destination : undefined;
  const auto = runAutoWorkflow({ errorType: item.error_type_label, facts, supplierCode: item.supplier_code, answers, supplierConfirmation, toleranceClass, destination });
  // A flow that ends in "Contact TMC" uses Toyota's recorded answer for the identical case.
  let tmc: BulkCandidate["tmc"] = null;
  let tmcDecided = false;
  if (needsTmc(auto.recommendation.reason)) {
    const key = escalationKey({ partNo: item.delivery_part_no, errorType: item.error_type_label, cas: facts.cas, flowId: auto.flow?.flowId });
    const esc = escalations?.get(key);
    const rec = esc ? tmcRecommendation(esc) : null;
    tmc = { key, status: esc?.status ?? "NEED", answer: esc?.answer ?? null };
    if (rec) {
      auto.recommendation = rec; tmcDecided = true;
      auto.procedureText = [auto.procedureText, `4) TMC confirmation: ${rec.comment}`].filter(Boolean).join("\n");
    }
  }
  const flow = auto.flow ? {
    flowId: auto.flow.flowId, implemented: auto.flow.implemented,
    trail: auto.flow.trail, next: auto.flow.next, outcome: auto.flow.outcome
  } : null;
  const keyPayload = {
    keyVersion: 2,
    errorType: item.error_type_label.trim().toLocaleLowerCase("en"),
    partNo: (item.delivery_part_no || "").trim().toUpperCase(),
    supplierCode: (item.supplier_code || "").trim().toUpperCase(),
    facts, supplierAnswers: answers,
    auto: { kind: auto.kind, needs: auto.needs, engineInput: auto.engineInput,
      recommendation: auto.recommendation, procedureText: auto.procedureText, flow }
  };
  const signature = createHash("sha256").update(stable(keyPayload)).digest("hex");
  const hasOpenStep = auto.steps.some((step) => step.status === "MANUAL" || step.status === "NEEDS_INPUT");
  const needsInput = Object.values(auto.needs).some(Boolean);
  const flowIsSafe = tmcDecided || auto.kind !== "substance" ||
    Boolean(auto.flow?.implemented && !auto.flow.next && auto.flow.outcome && auto.flow.outcome.state === auto.recommendation.state);
  const eligible = (auto.recommendation.state === "OK" || auto.recommendation.state === "NG")
    && auto.kind !== "manual" && !hasOpenStep && !needsInput && flowIsSafe
    && Boolean(auto.recommendation.comment.trim()) && Boolean(auto.procedureText.trim());
  const prohibited = kind === "substance";
  const gadsl = auto.steps.find((step) => step.id === "gadsl");
  const tsz = auto.steps.find((step) => step.id === "tsz");
  const connected = prohibited && (gadsl?.status === "DONE" || tsz?.status === "DONE") && Boolean(auto.flow);
  const reviewReason = eligible ? auto.recommendation.reason
    : auto.recommendation.state === "HOLD" ? auto.recommendation.reason
    : auto.steps.find((step) => step.status === "MANUAL" || step.status === "NEEDS_INPUT")?.detail
    || (needsInput ? "One or more required inputs are still missing." : "This case does not meet strict bulk-judgement conditions.");
  return {
    id: item.id, sourceRecordKey: item.source_record_key, errorType: item.error_type_label,
    partNo: item.delivery_part_no, supplierCode: item.supplier_code, cas: facts.cas,
    substanceName: facts.substanceName, kind, recommendation: auto.recommendation,
    procedureText: auto.procedureText, signature, eligible, draftFlow: Boolean(auto.flow?.draft) && !tmcDecided, ...(auto.flow?.caution ? { caution: auto.flow.caution } : {}),
    inPendingQueue: isWorking(item.source_status) && !item.judge,
    prohibited, prohibitedStatus: !prohibited ? "NOT_PROHIBITED" : connected ? "CONNECTED" : "NEEDS_REVIEW",
    reviewReason, tmc, evidence: evidenceOf(auto),
    card: classifyCase(auto, { eligible, tmcOpen: Boolean(tmc && !tmcDecided), facts: {
      "CAS": facts.cas, "Substance": facts.substanceName, "Content": facts.substanceContentPct ? facts.substanceContentPct + " %" : "",
      "Material": facts.materialName, "IMDS mass": facts.imdsMass ? facts.imdsMass + " g" : "", "Drawing mass": facts.drawingMass ? facts.drawingMass + " g" : "",
      "Application ID": facts.applicationId, "Company": facts.companyName
    } })
  };
}
export function groupBulkCandidates(candidates: BulkCandidate[]) {
  const grouped = new Map<string, BulkCandidate[]>();
  for (const item of candidates) {
    if (!item.eligible || !item.inPendingQueue) continue;
    const current = grouped.get(item.signature) ?? [];
    current.push(item); grouped.set(item.signature, current);
  }
  return [...grouped.entries()].filter(([, items]) => items.length > 1).map(([signature, items]) => ({
    signature, decision: items[0].recommendation.state as "OK" | "NG",
    comment: items[0].recommendation.comment, reason: items[0].recommendation.reason,
    procedureText: items[0].procedureText, items, count: items.length
  })).sort((a, b) => b.count - a.count);
}

/** One query for every row of the parts whose case needs the phthalate total (same material, other rows). */
export async function loadPhthalateSiblings(supabase: SupabaseClient, items: BulkSourceItem[]): Promise<Map<string, BulkSourceItem[]>> {
  const parts = [...new Set(items.filter((i) => FOUR_PHTHALATES.has(normalizeCas(extractRowFacts(i.raw_source).cas || "")))
    .map((i) => String(i.delivery_part_no ?? "").trim()).filter(Boolean))];
  const map = new Map<string, BulkSourceItem[]>();
  for (let i = 0; i < parts.length; i += 100) {
    const { data, error } = await supabase.from("gcat_error_items")
      .select("id,source_record_key,error_type_label,delivery_part_no,supplier_code,source_status,judge,raw_source")
      .in("delivery_part_no", parts.slice(i, i + 100)).limit(5000);
    if (error || !data) return map;
    for (const r of data as unknown as BulkSourceItem[]) {
      const k = String(r.delivery_part_no ?? "").trim().toUpperCase();
      map.set(k, [...(map.get(k) ?? []), r]);
    }
  }
  return map;
}
/** Everything a batch evaluation needs from the database, fetched up front. */
export async function loadBulkContext(supabase: SupabaseClient, items: BulkSourceItem[]): Promise<BulkContext> {
  const [confirmations, siblings] = await Promise.all([
    loadConfirmationsFor(supabase, items.map((i) => i.delivery_part_no)),
    loadPhthalateSiblings(supabase, items)
  ]);
  return { confirmations, siblings };
}

