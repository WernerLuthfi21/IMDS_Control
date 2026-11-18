// Plain-language "what to do next" for each checked item, and a per-part-number roll-up. Pure (unit-tested).
import type { AnalyzedRow, RowState } from "@/lib/intake/analyze";

export const STATE_LABEL: Record<RowState, string> = { OK: "OK", NG: "NG", ASK: "Answer needed", DEPENDS: "Depends on destination", HOLD: "Toyota reviews", INVALID: "Fix data" };
const SEVERITY: RowState[] = ["INVALID", "NG", "ASK", "DEPENDS", "HOLD", "OK"]; // worst first

export function resolution(r: AnalyzedRow): string {
  switch (r.state) {
    case "OK": return "No action needed.";
    case "NG": return r.comment ? `Likely rejected. Correct the data in IMDS and resubmit. Reason: ${r.comment}` : `Likely rejected. ${r.reason || "Correct the data in IMDS and resubmit."}`;
    case "ASK": return "Answer the question below. Your answer is saved for this part number so Toyota does not need to ask again.";
    case "DEPENDS": return r.dependsOn === "class" ? "The result depends on the tolerance class on Toyota's drawing. Toyota applies it; nothing to do now." : "The result depends on the vehicle destination. Toyota applies it; no action unless you know the destination.";
    case "HOLD": return r.reason || "Toyota reviews this item; nothing to do now.";
    case "INVALID": return r.issues[0] || r.reason || "Fix the data in the preview, then check again.";
  }
}

export type PartSummary = { partNo: string; worst: RowState; counts: Record<RowState, number>; items: AnalyzedRow[] };
export function byPart(rows: AnalyzedRow[]): PartSummary[] {
  const map = new Map<string, PartSummary>();
  for (const r of rows) {
    const k = r.partNo || "(no part number)";
    const p = map.get(k) ?? { partNo: k, worst: "OK" as RowState, counts: { OK: 0, NG: 0, ASK: 0, DEPENDS: 0, HOLD: 0, INVALID: 0 }, items: [] };
    p.counts[r.state]++; p.items.push(r);
    if (SEVERITY.indexOf(r.state) < SEVERITY.indexOf(p.worst)) p.worst = r.state;
    map.set(k, p);
  }
  return Array.from(map.values()).sort((a, b) => SEVERITY.indexOf(a.worst) - SEVERITY.indexOf(b.worst) || a.partNo.localeCompare(b.partNo));
}

/** Ready for Toyota only when nothing is waiting on the supplier. */
export function readiness(rows: AnalyzedRow[]) {
  const waiting = rows.filter((r) => r.state === "INVALID" || r.state === "ASK").length;
  const ng = rows.filter((r) => r.state === "NG").length;
  return { waiting, ng, ready: rows.length > 0 && waiting === 0 };
}
