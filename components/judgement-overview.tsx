"use client";
import type { ReactNode } from "react";
import { ArrowRight, CircleCheck, LoaderCircle } from "lucide-react";
import type { ReviewNeed } from "@/lib/judgement/review";
import { attentionItems, bottlenecks, type Attention, type NeedCounts, type RegisterSummary } from "@/lib/judgement/overview";

const R = 52;
const C = 2 * Math.PI * R;

/**
 * Judgement overview (layout from Jasmine's Auto-Judgement Overview, in the Judgement green):
 * one headline problem, what needs attention first, where the work is stuck and who it is with.
 * Every number is a count of register rows or review piles; clicking opens those cases.
 */
export function JudgementOverview({ kpis, summary, needs, needsLoading, onPile, onKm, onSupplier, onType }: {
  kpis?: ReactNode; summary: RegisterSummary; needs: NeedCounts | null; needsLoading: boolean;
  onPile: (need: ReviewNeed) => void; onKm: () => void; onSupplier: (code: string) => void; onType: (label: string) => void;
}) {
  const att = attentionItems(needs, summary.km);
  const top = att[0];
  const bars = bottlenecks(needs);
  const barMax = Math.max(1, ...bars.map((b) => b.n));
  const go = (a: Attention) => (a.tab === "km" ? onKm() : a.need && onPile(a.need));

  return <div className="ov">
    <section className="ov-hero" aria-label="Overall status">
      <div className="ov-hero-main">
        <div className="ov-ring" role="img" aria-label={`${summary.pct} percent judged`}>
          <svg viewBox="0 0 120 120" width="132" height="132" aria-hidden="true">
            <circle cx="60" cy="60" r={R} className="ov-ring-track"/>
            <circle cx="60" cy="60" r={R} className="ov-ring-fill" strokeDasharray={C.toFixed(1)} strokeDashoffset={(C * (1 - summary.pct / 100)).toFixed(1)}/>
          </svg>
          <b>{summary.pct}<small>%</small></b>
        </div>
        <div className="ov-hero-text">
          <span className="ov-eyebrow">{needsLoading && !needs ? "Checking the queue…" : top ? "Biggest issue right now" : "All clear"}</span>
          <h2>{needsLoading && !needs ? `${summary.pending.toLocaleString("en-US")} cases to judge` : top ? top.headline : "Nothing is blocked — every open case is moving"}</h2>
          <p>{summary.judged.toLocaleString("en-US")} of {summary.total.toLocaleString("en-US")} records judged · {summary.pending.toLocaleString("en-US")} still to judge · {summary.parts.toLocaleString("en-US")} part numbers</p>
          <div className="ov-prog" aria-hidden="true">{summary.band.filter((b) => b.n).map((b) => <i key={b.key} className={"b-" + b.key} style={{ width: (b.n / Math.max(1, summary.total)) * 100 + "%" }}/>)}</div>
          <div className="ov-legend">{summary.band.filter((b) => b.n).map((b) => <span key={b.key}><i className={"b-" + b.key}/>{b.label} {b.n.toLocaleString("en-US")}</span>)}</div>
        </div>
      </div>
      <div className="ov-hero-side">
        <span className="ov-eyebrow">Needs attention first</span>
        {needsLoading && !needs ? <div className="ov-att wait"><LoaderCircle size={15} className="spin"/><span>Sorting cases by what they need…</span></div>
          : att.length ? att.slice(0, 4).map((a) => <button type="button" key={a.key} className={"ov-att " + a.severity} onClick={() => go(a)}>
            <i aria-hidden="true"/><span>{a.label}</span><b>{a.n.toLocaleString("en-US")}</b><ArrowRight size={15} aria-hidden="true"/></button>)
          : <div className="ov-att ok"><CircleCheck size={16}/><span>Nothing is blocked</span></div>}
      </div>
    </section>

    {kpis}

    <div className="ov-grid">
      <section className="ov-card ov-c7">
        <h3>Where the bottleneck is</h3>
        <p className="ov-hint">Open cases by the one thing they still need. Click to open that pile as flashcards.</p>
        {needsLoading && !needs ? <p className="ov-empty"><LoaderCircle size={14} className="spin"/> Checking every pending case…</p>
          : bars.length ? <div className="ov-bars">{bars.map((b) => <button type="button" key={b.need} className={"ov-bar n-" + b.need} onClick={() => onPile(b.need)}>
            <span className="nm">{b.label}</span><span className="tr"><i style={{ width: (b.n / barMax) * 100 + "%" }}/></span><span className="v">{b.n.toLocaleString("en-US")}</span></button>)}</div>
          : <p className="ov-empty">Nothing open — every case has a judgement.</p>}
      </section>

      <section className="ov-card ov-c5">
        <h3>By supplier</h3>
        <p className="ov-hint">Suppliers with the most open cases. Click to see their cases.</p>
        {summary.suppliers.length ? <table className="ov-table">
          <thead><tr><th scope="col">Supplier</th><th scope="col">OK</th><th scope="col">NG</th><th scope="col">To judge</th><th scope="col">All</th></tr></thead>
          <tbody>{summary.suppliers.map((s) => <tr key={s.code}>
            <td><button type="button" className="ov-sup" onClick={() => onSupplier(s.code === "—" ? "" : s.code)}>{s.code}</button></td>
            <td className="ok">{s.ok || ""}</td><td className="ng">{s.ng || ""}</td><td className="pend">{s.pending}</td><td><b>{s.all}</b></td></tr>)}</tbody>
        </table> : <p className="ov-empty">No supplier has open cases.</p>}
      </section>

      <section className="ov-card ov-c12">
        <h3>Error types</h3>
        <p className="ov-hint">Open vs. judged, per error type. Click to list them.</p>
        <div className="ov-legend ov-legend-dark"><span><i className="b-pending"/>To judge</span><span><i className="b-ok"/>Judged</span></div>
        <div className="ov-bars">{summary.types.map((t) => <button type="button" key={t.label} className="ov-bar" onClick={() => onType(t.label)}>
          <span className="nm" title={t.label}>{t.label}</span>
          <span className="tr"><i className="o" style={{ width: (t.open / Math.max(1, t.all)) * 100 + "%" }}/><i className="f" style={{ width: (t.judged / Math.max(1, t.all)) * 100 + "%" }}/></span>
          <span className="v">{t.all.toLocaleString("en-US")}</span></button>)}</div>
      </section>
    </div>
  </div>;
}
