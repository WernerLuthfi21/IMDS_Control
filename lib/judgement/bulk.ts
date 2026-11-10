import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runAutoWorkflow, detectKind, type AutoOutput } from "@/lib/judgement/auto";
import { extractRowFacts } from "@/lib/judgement/row-facts";
import { familyOfKind, loadConfirmation } from "@/lib/intake/confirmations";
import { normalizeCas } from "@/lib/reference-data";

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
  prohibitedStatus: "CONNECTED" | "NEEDS_REVIEW" | "NOT_PROHIBITED"; reviewReason: string;
};

export function prohibitedConnectionStatus(input: {
  prohibited: boolean;
  gadslStatus?: string;
  tszStatus?: string;
  flowImplemented: boolean;
}): "CONNECTED" | "NEEDS_REVIEW" | "NOT_PROHIBITED" {
  if (!input.prohibited) return "NOT_PROHIBITED";
  const hasReferenceMatch = input.gadslStatus === "DONE" || input.tszStatus === "DONE";
  return hasReferenceMatch && input.flowImplemented ? "CONNECTED" : "NEEDS_REVIEW";
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return "{" + Object.keys(record).sort().map((key) => JSON.stringify(key) + ":" + stable(record[key])).join(",") + "}";
  }
  return JSON.stringify(value) ?? "null";
}
export async function evaluateBulkCandidate(supabase: SupabaseClient, item: BulkSourceItem): Promise<BulkCandidate> {
  const facts = extractRowFacts(item.raw_source);
  const kind = detectKind(item.error_type_label);
  const family = familyOfKind(kind);
  const stored = family ? await loadConfirmation(supabase, item, family, normalizeCas(facts.cas || "")) : null;
  const answers = stored?.answers ?? {};
  const supplierConfirmation = typeof answers.supplierConfirmation === "string" ? answers.supplierConfirmation : undefined;
  const toleranceClass = facts.toleranceClass || (typeof answers.toleranceClass === "string" ? answers.toleranceClass : undefined);
  const destination = typeof answers.destination === "string" ? answers.destination : undefined;
  const auto = runAutoWorkflow({ errorType: item.error_type_label, facts, answers, supplierConfirmation, toleranceClass, destination });
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
  const prohibited = kind === "substance";
  const gadsl = auto.steps.find((step) => step.id === "gadsl");
  const tsz = auto.steps.find((step) => step.id === "tsz");
  const prohibitedStatus = prohibitedConnectionStatus({
    prohibited,
    gadslStatus: gadsl?.status,
    tszStatus: tsz?.status,
    flowImplemented: auto.flow?.implemented === true
  });
  // A substance case is bulk-safe only when its reference match and dedicated flow
  // are both connected. A partial reference hit must never be treated as a routed case.
  const flowIsSafe = auto.kind !== "substance" ||
    Boolean(auto.flow?.implemented && !auto.flow.next && auto.flow.outcome && auto.flow.outcome.state === auto.recommendation.state);
  const eligible = (auto.recommendation.state === "OK" || auto.recommendation.state === "NG")
    && auto.kind !== "manual" && !hasOpenStep && !needsInput && flowIsSafe
    && (!prohibited || prohibitedStatus === "CONNECTED")
    && Boolean(auto.recommendation.comment.trim()) && Boolean(auto.procedureText.trim());
  const connected = prohibitedStatus === "CONNECTED";
  const unresolvedStep = auto.steps.find((step) => step.status === "MANUAL" || step.status === "NEEDS_INPUT");
  const reviewReason = prohibited && !connected
    ? "The case is not fully connected to a verified GADSL / TSZ reference and an implemented dedicated flow."
      + (unresolvedStep ? ` Next action: ${unresolvedStep.title}. ${unresolvedStep.detail}` : " Review CAS, substance name and Appendix routing.")
    : unresolvedStep ? `${unresolvedStep.title}: ${unresolvedStep.detail}`
    : eligible ? auto.recommendation.reason
    : auto.recommendation.state === "HOLD" ? auto.recommendation.reason
    : (needsInput ? "One or more required inputs are still missing." : "This case does not meet strict bulk-judgement conditions.");
  return {
    id: item.id, sourceRecordKey: item.source_record_key, errorType: item.error_type_label,
    partNo: item.delivery_part_no, supplierCode: item.supplier_code, cas: facts.cas,
    substanceName: facts.substanceName, kind, recommendation: auto.recommendation,
    procedureText: auto.procedureText, signature, eligible,
    inPendingQueue: item.source_status === "WORKING" && !item.judge,
    prohibited, prohibitedStatus,
    reviewReason
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
