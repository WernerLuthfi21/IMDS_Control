import type { CardQuestion } from "@/lib/judgement/review";
import { TOYOTA_OWNED } from "@/lib/judgement/constants";

/** Answers a reviewer gave on a card, in the shape /api/judgement/auto accepts. */
export type DeckAnswers = { destination?: string; toleranceClass?: string; supplierConfirmation?: string; answers: Record<string, string> };

/** Questions answered once per delivery part (vehicle destination, drawing class, Toyota-owned flow answers). */
const PART_SCOPED = new Set<string>([...TOYOTA_OWNED, "toleranceClass"]);

const norm = (v: string | null | undefined) => String(v ?? "").trim().toUpperCase();

/**
 * Which cards share an answer. Vehicle/drawing questions belong to the delivery part.
 * Supplier and Purchasing questions belong to the exact supplier + part + CAS + error type,
 * so one supplier's answer is never copied to another part or substance.
 * Returns null when the card has no question or the part number is missing (never shared then).
 */
export function answerKey(c: { partNo: string | null; supplierCode: string | null; cas?: string | null; errorType: string }, q: CardQuestion | null): string | null {
  if (!q) return null;
  const id = q.field === "answer" ? q.id : q.field;
  const part = norm(c.partNo);
  if (!part) return null;
  if (PART_SCOPED.has(id)) return ["P", part, id].join("|");
  const supplier = norm(c.supplierCode);
  if (!supplier) return null;
  return ["S", supplier, part, String(c.cas ?? "").trim(), c.errorType.trim().toLowerCase().replace(/\s+/g, " "), id, q.options.map((o) => o[0]).join(",")].join("|");
}

/** Add one answer to what a card already has. */
export function mergeAnswer(prev: DeckAnswers, field: string, value: string, qid: string): DeckAnswers {
  const next: DeckAnswers = { ...prev, answers: { ...prev.answers } };
  if (field === "destination") next.destination = value;
  else if (field === "toleranceClass") next.toleranceClass = value;
  else if (field === "supplierConfirmation") next.supplierConfirmation = value;
  else next.answers[qid] = value;
  return next;
}
