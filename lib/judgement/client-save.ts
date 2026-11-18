import type { AutoOutput } from "@/lib/judgement/auto";

/** One place in the browser that records a human judgement: evaluation trace first, then the register row. */
export async function saveJudgement(input: {
  itemId: string; caseId?: string | null; auto: Pick<AutoOutput, "engineInput">; procedure: string; judge: "OK" | "NG"; comment: string;
}): Promise<{ assigned_person?: string | null; starting_date?: string | null }> {
  const trace = await fetch("/api/judgement/evaluate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input.auto.engineInput, caseId: input.caseId || undefined }) });
  const traceJson = await trace.json().catch(() => ({}));
  if (!trace.ok) throw new Error(traceJson.error || "Could not record the evaluation trace.");
  const res = await fetch("/api/register/" + input.itemId, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
    judgement_procedure: input.procedure, judge: input.judge,
    ok_comment: input.judge === "OK" ? input.comment : null, imds_reject_comment: input.judge === "NG" ? input.comment : null }) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Could not save the judgement.");
  return (json.item || {}) as { assigned_person?: string | null; starting_date?: string | null };
}

/** Run the automatic checks for one case with the answers given so far. */
export async function runCheck(itemId: string, body: { destination?: string; toleranceClass?: string; supplierConfirmation?: string; answers?: Record<string, string> }): Promise<AutoOutput> {
  const r = await fetch("/api/judgement/auto", { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", body: JSON.stringify({ itemId, ...body }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Automatic check failed.");
  return j.result as AutoOutput;
}

export function rememberAnswer(itemId: string, partNo: string | null, field: string, value: string) {
  if (!partNo || !value) return;
  void fetch("/api/judgement/memory", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId, partNo, field, value }) }).catch(() => { /* convenience only */ });
}
