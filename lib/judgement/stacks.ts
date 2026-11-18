/**
 * Flashcard stacks: one stack per Error Type, each with a fixed colour so the same type always
 * looks the same (cards, stack tiles, G-CATS detail rows). Colours are presentation only — they do
 * not map a historical label to an official Error Type.
 */
export type StackTone = "red" | "orange" | "blue" | "violet" | "teal" | "amber" | "pink" | "slate" | "green" | "indigo";

const RULES: Array<[RegExp, StackTone]> = [
  [/prohibited|substance|reach|pops|svhc|annex/i, "red"],
  [/\belv\b|\(pb\)|\(cd\)|\(hg\)|\(cr/i, "orange"],
  [/warp/i, "violet"],
  [/mass|tolerance|weight/i, "blue"],
  [/sms|drawing/i, "teal"],
  [/application|app\s*44|appli/i, "amber"],
  [/material|class/i, "pink"],
  [/supplier|company|code/i, "indigo"]
];
const FALLBACK: StackTone[] = ["green", "slate", "indigo", "pink", "teal"];

/** Stable colour for an Error Type label. */
export function toneOf(errorType: string): StackTone {
  for (const [re, tone] of RULES) if (re.test(errorType)) return tone;
  let h = 0;
  for (const ch of errorType) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK[h % FALLBACK.length];
}

export type StackItem = { errorType: string; decided: boolean; state: "OK" | "NG" | "HOLD"; waiting: boolean };
export type Stack = {
  errorType: string; tone: StackTone; total: number;
  /** The rules reached OK/NG with nothing open — a person only confirms. */
  decided: number; ok: number; ng: number;
  /** Waiting on someone outside the reviewer (supplier, purchasing, TMC, missing data). */
  waiting: number;
  /** Needs the reviewer's answer or decision. */
  yours: number;
  /** Every card in the stack is decided by the rules: a candidate for full automation. */
  fullAuto: boolean;
};

/** Group cards into stacks by Error Type; biggest stacks first. */
export function buildStacks(items: StackItem[]): Stack[] {
  const m = new Map<string, Stack>();
  for (const it of items) {
    const key = it.errorType || "Unlabelled";
    const s = m.get(key) ?? { errorType: key, tone: toneOf(key), total: 0, decided: 0, ok: 0, ng: 0, waiting: 0, yours: 0, fullAuto: false };
    s.total++;
    if (it.decided) { s.decided++; if (it.state === "OK") s.ok++; else if (it.state === "NG") s.ng++; }
    else if (it.waiting) s.waiting++;
    else s.yours++;
    m.set(key, s);
  }
  return [...m.values()].map((s) => ({ ...s, fullAuto: s.total > 0 && s.decided === s.total }))
    .sort((a, b) => b.total - a.total || a.errorType.localeCompare(b.errorType));
}
