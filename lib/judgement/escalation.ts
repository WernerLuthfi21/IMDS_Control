import type { SupabaseClient } from "@supabase/supabase-js";
import { partKey } from "@/lib/judgement/memory";

/**
 * Cases an Appendix II flow sends to TMC/TMNA/TME/TDEM ("Contact TMC … do not judge yet").
 * The answer is kept per case key (part + error type + CAS + flow), so an identical case later
 * uses the same confirmed answer instead of asking Toyota again.
 */
export type EscalationStatus = "NEED" | "SENT" | "CONFIRMED";
export type Escalation = {
  caseKey: string; status: EscalationStatus; answer: "OK" | "NG" | null; note: string;
  sentAt: string | null; answeredAt: string | null; updatedByName: string | null;
};

export const TMC_PATTERN = /contact tmc|report the p\/n and supplier information to tmc/i;
export function needsTmc(reason: string | undefined | null): boolean { return TMC_PATTERN.test(String(reason || "")); }

export function escalationKey(input: { partNo: string | null | undefined; errorType: string; cas?: string | null; flowId?: string | null }): string {
  return [partKey(input.partNo) || "-", input.errorType.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 120), String(input.cas || "").trim() || "-", input.flowId || "-"].join("|");
}

export const ESCALATION_TABLE_MISSING = /judgement_escalations|relation .* does not exist|schema cache/i;

/** All escalations recorded for these delivery parts, keyed by case key. */
export async function loadEscalations(supabase: SupabaseClient, partNos: string[]): Promise<{ map: Map<string, Escalation>; available: boolean }> {
  const map = new Map<string, Escalation>();
  const uniq = [...new Set(partNos.map(partKey).filter(Boolean))];
  for (let i = 0; i < uniq.length; i += 200) {
    const { data, error } = await supabase.from("judgement_escalations")
      .select("case_key,status,answer,note,sent_at,answered_at,updated_by_name").in("part_no", uniq.slice(i, i + 200));
    if (error) { if (ESCALATION_TABLE_MISSING.test(error.message)) return { map, available: false }; throw new Error(error.message); }
    for (const r of data || []) map.set(r.case_key, { caseKey: r.case_key, status: r.status, answer: r.answer, note: r.note || "", sentAt: r.sent_at, answeredAt: r.answered_at, updatedByName: r.updated_by_name });
  }
  return { map, available: true };
}

/** The recommendation once Toyota answered. */
export function tmcRecommendation(e: Escalation): { state: "OK" | "NG"; comment: string; reason: string } | null {
  if (e.status !== "CONFIRMED" || !e.answer) return null;
  const when = (e.answeredAt || "").slice(0, 10);
  const comment = `Confirmed by TMC${when ? " on " + when : ""}${e.note ? ": " + e.note : "."}`;
  return { state: e.answer, comment, reason: `TMC answered ${e.answer}${when ? " on " + when : ""}${e.updatedByName ? " (recorded by " + e.updatedByName + ")" : ""}.` };
}
