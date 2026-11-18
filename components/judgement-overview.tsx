"use client";
import { ArrowRight, LoaderCircle } from "lucide-react";
import type { ReviewNeed } from "@/lib/judgement/review";
import { attentionItems, type NeedCounts, type RegisterSummary } from "@/lib/judgement/overview";

const R = 40;
const C = 2 * Math.PI * R;

/**
 * Statistics bar above the flashcards (layout idea from Jasmine's Overview, in the Judgement green):
 * % judged, where the open cases stand, and the biggest issue right now as one click.
 */
export function JudgeStats({ summary, needs, needsLoading, onPile, onKm }: {
  summary: RegisterSummary; needs: NeedCounts | null; needsLoading: boolean; onPile: (need: ReviewNeed) => void; onKm: () => void;
}) {
  const n = (k: ReviewNeed) => needs?.[k] ?? 0;
  const decided = n("ready");
  const yours = n("destination") + n("check") + n("drawing") + n("manual");
  const waiting = n("supplier") + n("purchasing") + n("tmc") + n("missing");
  const att = attentionItems(needs, summary.km);
  const top = att[0];
  const loadingNeeds = needsLoading && !needs;
  const num = (v: number) => (loadingNeeds ? "…" : v.toLocaleString("en-US"));

  return <section className="js" aria-label="Judgement statistics">
    <div className="js-ring" role="img" aria-label={`${summary.pct} percent judged`}>
      <svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r={R} className="ov-ring-track"/><circle cx="50" cy="50" r={R} className="ov-ring-fill" strokeDasharray={C.toFixed(1)} strokeDashoffset={(C * (1 - summary.pct / 100)).toFixed(1)}/></svg>
      <b>{summary.pct}<small>%</small></b>
    </div>
    <div className="js-main">
      <span className="js-eyebrow">{summary.judged.toLocaleString("en-US")} of {summary.total.toLocaleString("en-US")} judged · {summary.pending.toLocaleString("en-US")} to judge</span>
      {loadingNeeds ? <strong className="js-issue"><LoaderCircle size={16} className="spin"/> Sorting every pending case…</strong>
        : top ? <button type="button" className="js-issue" onClick={() => (top.tab === "km" ? onKm() : top.need && onPile(top.need))}><em>Biggest issue</em><span>{top.headline}</span><ArrowRight size={16}/></button>
        : <strong className="js-issue">Nothing is blocked</strong>}
      <div className="ov-prog" aria-hidden="true">{summary.band.filter((b) => b.n).map((b) => <i key={b.key} className={"b-" + b.key} style={{ width: (b.n / Math.max(1, summary.total)) * 100 + "%" }}/>)}</div>
    </div>
    <dl className="js-nums">
      <div className="d" title="The rules decided these: confirm only"><dt>Ready</dt><dd>{num(decided)}</dd></div>
      <div className="y" title="One answer from you each"><dt>Your answer</dt><dd>{num(yours)}</dd></div>
      <div className="w" title="Supplier, Purchasing, TMC or missing data"><dt>Waiting</dt><dd>{num(waiting)}</dd></div>
      <div className="k" title="Judged, TMA/KM judge still empty"><dt>Waiting TMA</dt><dd>{summary.km.toLocaleString("en-US")}</dd></div>
    </dl>
  </section>;
}
