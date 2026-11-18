/**
 * The three workflow piles of the Judge table, from the register's real fields:
 *  - toJudge:    WORKING record without an internal judgement (judge empty) — the only "remaining" work.
 *  - waitingTma: internal judgement saved (judge set), KM / TMA judge still empty — already judged.
 *  - judged:     internal judgement saved and the KM / TMA judge filled in.
 *  - other:      no judgement and not WORKING (e.g. accepted in G-CATS, closed) — not part of the queue.
 * A saved judgement never returns a record to toJudge; only clearing `judge` (reopen / undo) does.
 * Same definitions as the KPI tiles ("To judge", "Judged", "Awaiting KM") and summarizeRegister().
 */
export type Pile = "toJudge" | "judged" | "waitingTma" | "other";
export type PileRow = { id: string; source_status: string | null; judge: string | null; km_judge: string | null; error_type_label?: string | null };
export type PileCounts = { toJudge: number; judged: number; waitingTma: number; other: number; total: number; judgedTotal: number };

const filled = (v: string | null | undefined) => Boolean(v && String(v).trim());

/** G-CATS status "WORKING", tolerant of case and stray spaces. Every counter uses this one test. */
export const isWorking = (status: string | null | undefined) => String(status || "").trim().toUpperCase() === "WORKING";

export function pileOf(r: Pick<PileRow, "source_status" | "judge" | "km_judge">): Pile {
  if (filled(r.judge)) return filled(r.km_judge) ? "judged" : "waitingTma";
  return isWorking(r.source_status) ? "toJudge" : "other";
}

/** Counts per pile. Rows are counted once per id (a duplicated id never inflates a pile). */
export function pileCounts(rows: PileRow[], errorType?: string | null): PileCounts {
  const seen = new Set<string>();
  const c: PileCounts = { toJudge: 0, judged: 0, waitingTma: 0, other: 0, total: 0, judgedTotal: 0 };
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    if (errorType && (r.error_type_label || "") !== errorType) continue;
    c[pileOf(r)]++;
    c.total++;
  }
  c.judgedTotal = c.judged + c.waitingTma;
  return c;
}
