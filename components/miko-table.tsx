"use client";
import { forwardRef } from "react";
import type { PileCounts } from "@/lib/judgement/piles";

export type PileKind = "toJudge" | "waitingTma" | "judged";
export const PILE_LABEL: Record<PileKind, { title: string; sub: string; mark: string }> = {
  toJudge: { title: "To judge", sub: "never judged", mark: "TO JUDGE" },
  waitingTma: { title: "Waiting TMA", sub: "judged · awaiting TMA/KM", mark: "WAITING TMA" },
  judged: { title: "Judged", sub: "TMA/KM done", mark: "JUDGED" }
};

/** How many card edges to draw under the top card (more cards → a thicker stack, never more than 6). */
const depthOf = (n: number) => (n <= 0 ? 0 : Math.min(6, Math.ceil(Math.log2(n + 1))));

/** One physical card stack with its real count. Clicking it opens the records behind it. */
export const PileStack = forwardRef<HTMLButtonElement, { kind: PileKind; n: number; active?: boolean; bump?: boolean; onClick?: () => void }>(
  function PileStack({ kind, n, active, bump, onClick }, ref) {
    const l = PILE_LABEL[kind];
    const depth = depthOf(n);
    return <button ref={ref} type="button" className={"mt-pile p-" + kind + (active ? " on" : "") + (bump ? " bump" : "") + (n ? "" : " empty")} onClick={onClick}
      aria-label={`${l.title}: ${n.toLocaleString("en-US")} — ${l.sub}`} aria-pressed={active}>
      <span className="mt-edges" aria-hidden="true">{Array.from({ length: depth }, (_, i) => <i key={i} style={{ "--i": depth - i } as React.CSSProperties}/>)}</span>
      <span className="mt-face">
        <small>{l.mark}</small>
        <b>{n.toLocaleString("en-US")}</b>
        <em>{l.sub}</em>
      </span>
    </button>;
  });

/** The three workflow piles. To Judge = never judged; Waiting TMA and Judged are both already judged. */
export function Piles({ piles, toJudge, active, bump, onPile, refs }: {
  piles: PileCounts; toJudge?: number; active?: PileKind; bump?: PileKind | null;
  onPile: (k: PileKind) => void; refs?: { current: Partial<Record<PileKind, HTMLButtonElement | null>> };
}) {
  const set = (k: PileKind) => (el: HTMLButtonElement | null) => { if (refs) refs.current[k] = el; };
  return <div className="mt-piles" role="group" aria-label="Workflow piles">
    <PileStack ref={set("toJudge")} kind="toJudge" n={toJudge ?? piles.toJudge} active={active === "toJudge"} bump={bump === "toJudge"} onClick={() => onPile("toJudge")}/>
    <PileStack ref={set("waitingTma")} kind="waitingTma" n={piles.waitingTma} active={active === "waitingTma"} bump={bump === "waitingTma"} onClick={() => onPile("waitingTma")}/>
    <PileStack ref={set("judged")} kind="judged" n={piles.judged} active={active === "judged"} bump={bump === "judged"} onClick={() => onPile("judged")}/>
  </div>;
}
