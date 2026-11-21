"use client";
import { useEffect, useLayoutEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, CircleX, ExternalLink, FileText, FileWarning, History, LoaderCircle, RotateCcw } from "lucide-react";
import { NEED_LABEL, type ReviewCard, type ReviewNeed } from "@/lib/judgement/review";
import { toneOf } from "@/lib/judgement/stacks";
import { checkComment, lastComment, typeKey, type CommentHistory } from "@/lib/judgement/comment-history";

/** A pending case as the deck receives it from /api/judgement/bulk. */
export type Candidate = {
  id: string; sourceRecordKey: string; errorType: string; partNo: string | null; supplierCode: string | null; cas?: string; kind: string;
  recommendation: { state: "OK" | "NG" | "HOLD"; comment: string; reason: string }; procedureText: string; signature: string;
  eligible: boolean; inPendingQueue: boolean; draftFlow?: boolean; caution?: string; card: ReviewCard; evidence?: string[];
};
/** What a card shows now: the first evaluation, or the re-check after answers. */
export type View = { card: ReviewCard; rec: Candidate["recommendation"]; decided: boolean; procedure: string; draft: boolean; caution: string; evidence: string[] };
/** Answers that belong to Toyota for the whole part (applied to every case of the part). */
export const TOYOTA_FIELDS = new Set(["destination", "toleranceClass", "usCarpet", "nonEuReq"]);
/** Needs that wait on someone other than the reviewer. */
export const WAITING = new Set<ReviewNeed>(["supplier", "purchasing", "tmc", "missing"]);
export const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const SWIPE = 90;

/**
 * One flashcard: the case on the left (part, facts, why), the decision on the right.
 * Navigation sits in the card header; drag or swipe sideways to move through the stack.
 */
export function Flashcard({ cardRef, dealFrom, stamp, active, c, v, pos, total, left, canEdit, enter, busy, error, similar, answered, history, comment, onComment, onAnswer, onConfirm, onReset, onPrev, onSkip, onOpen, onDetail }: {
  cardRef: { current: HTMLElement | null }; dealFrom: () => DOMRect | null; stamp: "OK" | "NG" | null;
  active: boolean; c: Candidate; v: View; pos: number; total: number; left: number; canEdit: boolean; enter: "next" | "prev" | "up"; busy: boolean; error: string; similar: number; answered: boolean;
  history: CommentHistory; comment: string; onComment: (t: string) => void; onAnswer: (field: string, value: string, qid: string, all: boolean) => void;
  onConfirm: (j: "OK" | "NG") => void; onReset: () => void; onPrev: () => void; onSkip: () => void; onOpen: () => void; onDetail: () => void;
}) {
  const [all, setAll] = useState(true);
  const [drag, setDrag] = useState<{ x0: number; dx: number; id: number } | null>(null);
  const q = v.decided ? null : v.card.question;
  // Miko deals the card from its Error Type deck (forward moves only; reduced motion: no flight).
  useLayoutEffect(() => {
    const el = cardRef.current; const from = dealFrom();
    if (!el || enter === "prev" || reducedMotion()) return;
    const to = el.getBoundingClientRect();
    const dx = from ? from.left + from.width / 2 - (to.left + to.width / 2) : 0; const dy = from ? from.top + from.height / 2 - (to.top + to.height / 2) : 30;
    const k = from ? Math.max(0.12, Math.min(0.35, from.width / Math.max(1, to.width))) : 0.96;
    el.style.willChange = "transform, opacity";
    const anim = el.animate([
      { transform: `translate3d(${dx}px, ${dy}px, 0) scale(${k}) rotate(-6deg)`, opacity: 0 },
      { transform: `translate3d(${dx * 0.25}px, ${dy * 0.25 - 18}px, 0) scale(${(1 + k) / 2 + 0.2}) rotate(-1.5deg)`, opacity: 1, offset: 0.6 },
      { transform: "translate3d(0,0,0) scale(1) rotate(0)", opacity: 1 }],
      { duration: 560, easing: "cubic-bezier(.22,1,.36,1)" });
    anim.onfinish = () => { el.style.willChange = ""; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const tone = toneOf(c.errorType);
  const decision = v.decided ? v.rec.state : null;
  const waiting = WAITING.has(v.card.need);
  const last = lastComment(history, c.partNo, c.errorType);
  const usual = decision ? (history.byType.get(typeKey(c.errorType, decision)) ?? []).slice(0, 3) : [];
  const fit = decision ? checkComment(history, c.errorType, decision, comment) : null;
  const short = q ? q.options.every(([, l]) => l.length <= 8) : false;
  // One line of "why", only when it says more than the pile name or the question.
  const rawWhy = (decision ? v.rec.reason : v.card.reason || "").trim();
  const why = rawWhy && rawWhy.length > 24 && rawWhy !== q?.text && rawWhy !== NEED_LABEL[v.card.need].hint ? rawWhy : "";

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      // Shortcuts only belong to the judgement table. Focus on a link, a tab, a switch, a dialog or anywhere
      // else on the page (sidebar, search, settings) keeps its own keys — Enter on "Back to menu" navigates,
      // it never saves a judgement.
      const onBody = !t || t === document.body || t === document.documentElement;
      if (!onBody && !t?.closest(".mt")) return;
      if (t?.closest("a, [role='dialog'], [role='tab'], [role='switch'], [role='checkbox'], [contenteditable='true']")) return;
      const onControl = Boolean(t?.closest("button, label, summary"));
      if (e.key === "ArrowRight") { e.preventDefault(); onSkip(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); onPrev(); }
      else if (e.key === "Enter" && decision && !busy && canEdit && !onControl) { e.preventDefault(); onConfirm(decision as "OK" | "NG"); }
      else if (/^[1-9]$/.test(e.key) && q && !busy && canEdit) { const o = q.options[Number(e.key) - 1]; if (o) { e.preventDefault(); onAnswer(q.field, o[0], q.id, all); } }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const interactive = (el: EventTarget | null) => el instanceof Element && Boolean(el.closest("button, a, input, textarea, select, label"));
  const dx = drag?.dx ?? 0;

  return <div className={"jc-wrap t-" + tone}>
    {left > 1 && <div className="jc-ghost g2" aria-hidden="true"/>}
    {left > 0 && <div className="jc-ghost g1" aria-hidden="true"/>}
    <article ref={(el) => { cardRef.current = el; }} className={"jc t-" + tone + (enter === "prev" ? " enter-prev" : "") + (drag ? " dragging" : "") + (stamp ? " stamped" : "")} aria-live="polite" aria-busy={busy} aria-roledescription="flashcard"
      style={dx ? { transform: `translateX(${dx}px) rotate(${dx / 40}deg)` } : undefined}
      onPointerDown={(e) => { if (e.button !== 0 || interactive(e.target)) return; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setDrag({ x0: e.clientX, dx: 0, id: e.pointerId }); }}
      onPointerMove={(e) => { if (drag && e.pointerId === drag.id) setDrag({ ...drag, dx: e.clientX - drag.x0 }); }}
      onPointerUp={() => { if (!drag) return; const d = drag.dx; setDrag(null); if (d < -SWIPE) onSkip(); else if (d > SWIPE) onPrev(); }}
      onPointerCancel={() => setDrag(null)}>

      {stamp && <div className={"jc-stamp " + stamp.toLowerCase()} aria-hidden="true">JUDGED · {stamp}</div>}
      <header className="jc-head">
        <span className="jc-type">{c.errorType}</span>
        <span className={"jc-need n-" + v.card.need}>{NEED_LABEL[v.card.need].title}</span>
        <nav className="jc-nav" aria-label="Move through the stack" title="← → or swipe">
          <button type="button" onClick={onPrev} aria-label="Previous card" disabled={pos <= 1}><ArrowLeft size={16}/></button>
          <span><b>{pos}</b> / {total}</span>
          <button type="button" onClick={onSkip} aria-label="Next card" disabled={left <= 0}><ArrowRight size={16}/></button>
        </nav>
      </header>

      <div className="jc-body">
        <section className="jc-case">
          <div className="jc-id" title={c.sourceRecordKey}>
            <strong>{c.partNo || "No part number"}</strong>
            <span className="jc-chip">Supplier {c.supplierCode || "—"}</span>
          </div>
          {v.evidence.length > 0 && <div className="jc-evidence"><small>Answered from the row</small><ul>{v.evidence.map((e) => <li key={e}>{e}</li>)}</ul></div>}
          {c.card.facts.length > 0 && <dl className="jc-facts">{c.card.facts.map(([k, val]) => <div key={k} className={val.length > 26 ? "wide" : ""}><dt>{k}</dt><dd>{val}</dd></div>)}</dl>}
          <div className="jc-links">
            <button type="button" onClick={onDetail} disabled={!c.partNo}><FileText size={13}/> G-CATS detail</button>
            <button type="button" onClick={onOpen}><ExternalLink size={13}/> Full case &amp; flow</button>
            {answered && canEdit && <button type="button" disabled={busy} onClick={onReset}><RotateCcw size={13}/> Change answers</button>}
          </div>
        </section>

        <section className={"jc-decide " + (decision ? decision.toLowerCase() : waiting ? "wait" : "ask")}>
          {decision ? <>
            <div className="jc-verdict">
              <span className={"jc-badge " + decision.toLowerCase()} aria-hidden="true">{decision === "OK" ? <Check size={26} strokeWidth={3.2}/> : <CircleX size={26} strokeWidth={2.6}/>}</span>
              <div><small>Decision</small><strong>{decision}</strong></div>
            </div>
            {why && <p className="jc-why">{why}</p>}
            <div className="jc-comment">
              <label htmlFor={"cm-" + c.id}>Comment for G-CATS {fit?.kind === "match" ? <em className="ok"><History size={12}/> used {fit.count}×</em> : fit?.kind === "new" ? <em className="new"><AlertTriangle size={12}/> new wording</em> : null}</label>
              <textarea id={"cm-" + c.id} rows={2} value={comment} onChange={(e) => onComment(e.target.value)} disabled={!canEdit}/>
              {(last || usual.length > 0) && <div className="jc-usual">
                {last && <span className="jc-last" title="Comment(last time) in G-CATS">Last: {last}</span>}
                {usual.map((u) => <button type="button" key={u.comment} className={u.comment.toLowerCase() === comment.trim().toLowerCase() ? "on" : ""} onClick={() => onComment(u.comment)} disabled={!canEdit} title="Use this comment">{u.comment} <i>{u.count}×</i></button>)}
              </div>}
            </div>
            {canEdit && <button type="button" className={"jc-go " + decision.toLowerCase()} disabled={busy || !comment.trim()} onClick={() => onConfirm(decision as "OK" | "NG")}>
              {busy ? <LoaderCircle size={18} className="spin"/> : <Check size={18}/>} Confirm {decision}<kbd>Enter</kbd></button>}
          </> : q ? <>
            {(v.rec.state === "OK" || v.rec.state === "NG") && <p className={"jc-rec " + v.rec.state.toLowerCase()}><span>Recommended {v.rec.state}</span> not final · a person confirms the answer below</p>}
            <div className="jc-ask"><small>Answer</small><strong>{q.text}</strong></div>
            <div className={"jc-opts" + (short ? " short" : "")}>{q.options.map(([val, label], i) => <button type="button" key={val} disabled={busy || !canEdit} onClick={() => onAnswer(q.field, val, q.id, all)}><kbd>{i + 1}</kbd><span>{label}</span></button>)}</div>
            {similar > 0 && canEdit && <label className="jc-same"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)}/><span>Also answer <b>{similar}</b> more · {TOYOTA_FIELDS.has(q.field === "answer" ? q.id : q.field) ? "same part" : "same supplier, part, CAS"}</span></label>}
            {busy && <p className="jc-busy"><LoaderCircle size={14} className="spin"/> Checking the rules…</p>}
          </> : <>
            <div className="jc-verdict">
              <span className={"jc-badge " + (waiting ? "wait" : "ask")} aria-hidden="true"><AlertTriangle size={24} strokeWidth={2.4}/></span>
              <div><small>{waiting ? "Waiting" : "Next step"}</small><strong className="sm">{NEED_LABEL[v.card.need].title}</strong></div>
            </div>
            {!why && <p className="jc-hint">{NEED_LABEL[v.card.need].hint}</p>}
            <button type="button" className="jc-go ghost" onClick={onOpen}><ExternalLink size={16}/> Open full case</button>
          </>}
          {why && !decision && <p className="jc-why">{why}</p>}
          {v.draft && <p className="jc-caution"><FileWarning size={14}/> {v.caution || "Draft flow: a person confirms, the system never finalises it."}</p>}
          {error && <div className="jx-error" role="alert"><AlertTriangle size={13}/> {error}</div>}
        </section>
      </div>
      <div className="jc-meter" aria-hidden="true"><i style={{ width: (pos / Math.max(1, total)) * 100 + "%" }}/></div>
    </article>
  </div>;
}
