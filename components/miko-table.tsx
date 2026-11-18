"use client";
import { forwardRef } from "react";
import { Sparkles } from "lucide-react";
import type { PileCounts } from "@/lib/judgement/piles";
import type { Stack } from "@/lib/judgement/stacks";

export type PileKind = "toJudge" | "waitingTma" | "judged";
export type PileTop = { part: string; type: string; tag?: string } | null;
export const PILE_LABEL: Record<PileKind, { title: string; sub: string; mark: string }> = {
  toJudge: { title: "To judge", sub: "never judged", mark: "TO JUDGE" },
  waitingTma: { title: "Waiting TMA", sub: "judged · awaiting TMA/KM", mark: "WAITING TMA" },
  judged: { title: "Judged", sub: "TMA/KM done", mark: "JUDGED" }
};

/** How many card edges to draw under the top card (more cards → a thicker stack, never more than 6). */
export const depthOf = (n: number) => (n <= 0 ? 0 : Math.min(6, Math.ceil(Math.log2(n + 1))));
const Edges = ({ n }: { n: number }) => { const d = depthOf(n); return <span className="mt-edges" aria-hidden="true">{Array.from({ length: d }, (_, i) => <i key={i} style={{ "--i": d - i } as React.CSSProperties}/>)}</span>; };

/** A workflow pile: a stack of real cases, the top card shows the case on top. */
export const PileStack = forwardRef<HTMLButtonElement, { kind: PileKind; n: number; top?: PileTop; active?: boolean; bump?: boolean; onClick?: () => void }>(
  function PileStack({ kind, n, top, active, bump, onClick }, ref) {
    const l = PILE_LABEL[kind];
    return <button ref={ref} type="button" className={"mt-pile p-" + kind + (active ? " on" : "") + (bump ? " bump" : "") + (n ? "" : " empty")} onClick={onClick}
      aria-label={`${l.title}: ${n.toLocaleString("en-US")} — ${l.sub}${top ? `, top case ${top.part}` : ""}`} aria-pressed={active}>
      <Edges n={n}/>
      <span className="mt-face">
        <span className="mt-face-top"><small>{l.mark}</small><b>{n.toLocaleString("en-US")}</b></span>
        <span className="mt-case">{top && n ? <><strong>{top.part}</strong><em>{top.type}</em>{top.tag === "OK" || top.tag === "NG" ? <i className={top.tag.toLowerCase()}>{top.tag}</i> : null}</> : <em>{l.sub}</em>}</span>
      </span>
    </button>;
  });

/** The three workflow piles. To Judge = never judged; Waiting TMA and Judged are both already judged. */
export function Piles({ piles, toJudge, tops, active, bump, onPile, refs }: {
  piles: PileCounts; toJudge?: number; tops?: Partial<Record<PileKind, PileTop>>; active?: PileKind; bump?: PileKind | null;
  onPile: (k: PileKind) => void; refs?: { current: Partial<Record<PileKind, HTMLButtonElement | null>> };
}) {
  const set = (k: PileKind) => (el: HTMLButtonElement | null) => { if (refs) refs.current[k] = el; };
  return <div className="mt-piles" role="group" aria-label="Workflow piles">
    {(["toJudge", "waitingTma", "judged"] as PileKind[]).map((k) => <PileStack key={k} ref={set(k)} kind={k}
      n={k === "toJudge" ? toJudge ?? piles.toJudge : piles[k]} top={tops?.[k] ?? null} active={active === k} bump={bump === k} onClick={() => onPile(k)}/>)}
  </div>;
}

/** One deck of cards per Error Type (rule family) still to judge. */
export function Decks({ stacks, selected, onPick, label, refs }: {
  stacks: Stack[]; selected: string | null; onPick: (errorType: string) => void; label: (t: string) => string;
  refs?: { current: Record<string, HTMLButtonElement | null> };
}) {
  return <div className="mt-decks" role="tablist" aria-label="Error types still to judge">
    {stacks.map((s) => <button type="button" role="tab" key={s.errorType} aria-selected={s.errorType === selected}
      ref={(el) => { if (refs) refs.current[s.errorType] = el; }}
      title={`${s.errorType}: ${s.decided} ready · ${s.yours} need your answer · ${s.waiting} waiting`}
      className={"mt-deck t-" + s.tone + (s.errorType === selected ? " on" : "")} onClick={() => onPick(s.errorType)}>
      <Edges n={s.total}/>
      <span className="mt-deck-face">
        <span className="mt-deck-top"><span className="jb-orb" aria-hidden="true">{s.fullAuto ? <Sparkles size={11}/> : null}</span><b>{s.total.toLocaleString("en-US")}</b></span>
        <span className="mt-deck-name">{label(s.errorType)}</span>
        <span className="mt-deck-bar" aria-hidden="true"><i className="d" style={{ width: (s.decided / s.total) * 100 + "%" }}/><i className="y" style={{ width: (s.yours / s.total) * 100 + "%" }}/><i className="w" style={{ width: (s.waiting / s.total) * 100 + "%" }}/></span>
        <span className="mt-deck-stats"><span className="d">{s.decided} ready</span><span>{s.yours} you</span><span className="w">{s.waiting} wait</span></span>
      </span>
    </button>)}
  </div>;
}
