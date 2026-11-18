import type { BulkCandidate } from "@/lib/judgement/bulk";

/**
 * Auto-judgement (Werner's decision, 18 Nov 2026): a case the engine can decide completely —
 * every step done, no question left, an encoded flow, a comment and a procedure — may be written
 * as FINAL by the system without a human, but only for rule families an admin switched on.
 * Error Type 19 and every HOLD stay with people. Every automatic decision is audited and can be reopened.
 */
export const AUTO_KINDS = ["mass", "sms", "app44", "pb", "elv", "substance", "warp"] as const;
export type AutoKind = (typeof AUTO_KINDS)[number];
export const AUTO_KIND_LABEL: Record<AutoKind, string> = {
  mass: "Mass tolerance (Error Type 7, TSZ2900G)",
  sms: "SMS mass (Error Type 6, supplier answer on file)",
  app44: "Application 44 (supplier answer on file)",
  pb: "ELV Pb (policy table / App. code 71 flow)",
  elv: "ELV Cd / Hg / Cr6+ (Manual Flow Ver.7 No.11–13)",
  substance: "Prohibited substances (Manual Flow Ver.7 No.14–19)",
  warp: "WARP part number (No.21, Purchasing supplier code master)"
};
export const SYSTEM_ACTOR = "Auto-judgement (System)";
/**
 * Version of the encoded rule set. When the rules change (new source manual), an approval given for
 * the old rules no longer counts: an admin must save the Rules panel again before anything is finalised.
 */
export const RULESET = "gcats-manual-flow-ver7";
export const RULESET_LABEL = "G-CATS Manual Flow Ver.7";

export type AutoJudgeConfig = {
  enabled: boolean;          // master switch
  shadow: boolean;           // decide but do not write; show what would happen
  kinds: Record<AutoKind, boolean>;
  approvedBy: string | null; // who last switched rules on (the owner's approval, recorded)
  approvedAt: string | null;
  ruleSet: string | null;    // rule set the approval was given for
};
export const DEFAULT_AUTOJUDGE: AutoJudgeConfig = {
  enabled: false, shadow: true,
  kinds: { mass: false, sms: false, app44: false, pb: false, elv: false, substance: false, warp: false },
  approvedBy: null, approvedAt: null, ruleSet: null
};

export function sanitizeAutoJudge(value: unknown): AutoJudgeConfig {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const k = (v.kinds && typeof v.kinds === "object" ? v.kinds : {}) as Record<string, unknown>;
  const kinds = Object.fromEntries(AUTO_KINDS.map((kind) => [kind, k[kind] === true])) as Record<AutoKind, boolean>;
  return {
    enabled: v.enabled === true,
    shadow: v.shadow !== false,
    kinds,
    approvedBy: typeof v.approvedBy === "string" ? v.approvedBy.slice(0, 120) : null,
    approvedAt: typeof v.approvedAt === "string" ? v.approvedAt.slice(0, 40) : null,
    ruleSet: typeof v.ruleSet === "string" ? v.ruleSet.slice(0, 80) : null
  };
}

export type AutoDecision =
  | { action: "FINAL"; decision: "OK" | "NG"; reason: string }
  | { action: "WOULD_FINAL"; decision: "OK" | "NG"; reason: string }   // shadow mode / master switch off
  | { action: "SKIP"; reason: string };

const isType19 = (errorType: string) => /^\s*(?:error\s*type\s*)?19(?:\.0)?\b/i.test(errorType);

export function decideAuto(c: Pick<BulkCandidate, "kind" | "eligible" | "inPendingQueue" | "recommendation" | "errorType" | "reviewReason"> & { draftFlow?: boolean }, cfg: AutoJudgeConfig): AutoDecision {
  if (!c.inPendingQueue) return { action: "SKIP", reason: "Not in the pending queue (already judged or not WORKING)." };
  if (isType19(c.errorType)) return { action: "SKIP", reason: "Error Type 19 is always HOLD pending process-owner reconciliation." };
  if (c.kind === "manual") return { action: "SKIP", reason: "No encoded rule for this error type." };
  if (!c.eligible || (c.recommendation.state !== "OK" && c.recommendation.state !== "NG")) return { action: "SKIP", reason: c.reviewReason || "The engine could not decide this case completely." };
  if (c.draftFlow) return { action: "SKIP", reason: "The flow is a draft in its source document (e.g. MCCP). A person confirms; the system never finalises it." };
  const decision = c.recommendation.state;
  if (!cfg.kinds[c.kind as AutoKind]) return { action: "WOULD_FINAL", decision, reason: `Rule family "${c.kind}" is not switched on for auto-judgement.` };
  if (cfg.ruleSet !== RULESET) return { action: "WOULD_FINAL", decision, reason: `The rules were updated to ${RULESET_LABEL}. An admin must review and save the Rules panel again before the system finalises anything.` };
  if (!cfg.enabled || cfg.shadow) return { action: "WOULD_FINAL", decision, reason: cfg.enabled ? "Shadow mode: decided but not written." : "Auto-judgement master switch is off." };
  return { action: "FINAL", decision, reason: c.recommendation.reason };
}
