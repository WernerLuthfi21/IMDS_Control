import type { AutoOutput } from "@/lib/judgement/auto";
import { TOYOTA_OWNED, DESTINATION_OPTIONS, REVIEWER_CHECK } from "@/lib/judgement/constants";

/**
 * Review deck: every pending case the engine cannot finish is sorted by WHAT it still needs,
 * so a person handles one kind of question at a time (flashcards), with the answer buttons
 * already on the card.
 */
export type ReviewNeed = "ready" | "destination" | "check" | "drawing" | "supplier" | "purchasing" | "tmc" | "missing" | "manual";
export const NEED_ORDER: ReviewNeed[] = ["ready", "destination", "check", "drawing", "supplier", "purchasing", "tmc", "missing", "manual"];
export const NEED_LABEL: Record<ReviewNeed, { title: string; hint: string }> = {
  ready: { title: "Ready to confirm", hint: "The rules reached OK or NG. Check and confirm." },
  destination: { title: "Vehicle destination", hint: "Pick where the vehicle goes. Remembered for the part." },
  check: { title: "Reviewer check", hint: "Read it in the appendix, TSZ0001G or the IMDS data and pick the answer." },
  drawing: { title: "Drawing class", hint: "Read the mass tolerance class (MA–MF) from the drawing." },
  supplier: { title: "Supplier answer", hint: "Record what the supplier confirmed." },
  purchasing: { title: "Purchasing answer", hint: "Record what Purchasing confirmed." },
  tmc: { title: "TMC confirmation", hint: "The flow says: ask TMC/TMNA/TME/TDEM first." },
  missing: { title: "Missing data", hint: "CAS or source data is missing or ambiguous." },
  manual: { title: "Manual judgement", hint: "No encoded rule or flow for this case yet." }
};

export type CardQuestion = { id: string; text: string; options: Array<[string, string]>; field: "destination" | "toleranceClass" | "supplierConfirmation" | "answer" };
export type ReviewCard = {
  need: ReviewNeed; reason: string; question: CardQuestion | null;
  facts: Array<[string, string]>;
};

const CLASS_OPTIONS: Array<[string, string]> = ["MA", "MB", "MC", "MD", "ME", "MF"].map((c) => [c, c]);

export function classifyCase(auto: AutoOutput, opts: { eligible: boolean; tmcOpen: boolean; facts: Record<string, string> }): ReviewCard {
  const facts = Object.entries(opts.facts).filter(([, v]) => v).slice(0, 6) as Array<[string, string]>;
  const r = auto.recommendation;
  const card = (need: ReviewNeed, reason: string, question: CardQuestion | null = null): ReviewCard => ({ need, reason, question, facts });
  if (opts.eligible && (r.state === "OK" || r.state === "NG")) return card("ready", r.reason);
  if (opts.tmcOpen) return card("tmc", r.reason);
  if (/Error Type 19 is always HOLD/i.test(r.reason)) return card("tmc", r.reason);
  const lookupGap = auto.steps.find((s) => s.status === "MANUAL" && (s.id === "gadsl" || s.id === "imds" || s.id === "drawing"));
  if (lookupGap) return card("missing", lookupGap.detail);
  // No rule in the G-CATS manual for this error type (e.g. TMC-only types 22/23): TMC answers it.
  if (auto.kind === "manual") return card("tmc", "No rule for this error type in the G-CATS manual (TMC only). Ask TMC and record the answer.");
  const pbDate = auto.steps.find((s) => s.id === "dest" && s.status === "MANUAL");
  if (pbDate) return card("tmc", `${pbDate.detail} Confirm the date with TMC (Manual Flow Ver.7 No.10 remark).`);
  if (auto.flow && !auto.flow.implemented) return card("manual", r.reason);
  if (auto.needs.destination || auto.flow?.next?.id === "destination") {
    return card("destination", "Destination decides which rule applies.", { id: "destination", text: "Vehicle destination", options: DESTINATION_OPTIONS, field: "destination" });
  }
  if (auto.kind === "mass" && auto.needs.toleranceClass) {
    return card("drawing", "Mass tolerance class is not in the source row.", { id: "toleranceClass", text: "Mass tolerance class on the drawing", options: CLASS_OPTIONS, field: "toleranceClass" });
  }
  if (auto.needs.supplierConfirmation) {
    const options: Array<[string, string]> = auto.kind === "app44"
      ? [["SUPPLIER_CONFIRMED", "A · Supplier confirms the application / code"], ["INPUT_MISTAKE", "B · Input mistake"]]
      : [["ACTUAL_OR_CALCULATED_MASS", "A · Actual / calculated mass"], ["INPUT_MISTAKE", "B · Input mistake"]];
    return card("supplier", r.reason, { id: "supplierConfirmation", text: "What did the supplier confirm?", options, field: "supplierConfirmation" });
  }
  const next = auto.flow?.next;
  if (next) {
    const need: ReviewNeed = next.id === "purchasingWarp" || next.id === "purchasingSms" ? "purchasing" : TOYOTA_OWNED.has(next.id) ? "destination" : REVIEWER_CHECK.has(next.id) ? "check" : "supplier";
    return card(need, r.reason, { id: next.id, text: next.text, options: next.options, field: "answer" });
  }
  if (auto.steps.some((s) => s.status === "MANUAL")) return card("missing", auto.steps.find((s) => s.status === "MANUAL")?.detail || r.reason);
  return card("manual", r.reason || "Needs a person.");
}

/** The automatic answers of a run, for the card's evidence list (at most five): "question — answer". */
export function evidenceOf(auto: AutoOutput): string[] {
  return (auto.flow?.trail ?? []).filter((t) => t.auto).map((t) => `${t.question} — ${t.answer}`).slice(0, 5);
}
