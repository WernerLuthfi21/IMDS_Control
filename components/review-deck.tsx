"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCheck, CircleX, ExternalLink, FileText, FileWarning, History, LoaderCircle, RefreshCw, RotateCcw, Sparkles } from "lucide-react";
import type { AutoOutput } from "@/lib/judgement/auto";
import { classifyCase, NEED_LABEL, NEED_ORDER, type ReviewCard, type ReviewNeed } from "@/lib/judgement/review";
import { rememberAnswer, runCheck, saveJudgement } from "@/lib/judgement/client-save";
import { answerKey, mergeAnswer, type DeckAnswers } from "@/lib/judgement/deck";
import { CatMascot } from "@/components/cat-mascot";
import type { NeedCounts } from "@/lib/judgement/overview";
import { buildStacks, toneOf, type Stack } from "@/lib/judgement/stacks";
import { checkComment, lastComment, typeKey, type CommentHistory } from "@/lib/judgement/comment-history";

type Row = { id: string; source_record_key: string; error_type_label: string; delivery_part_no: string | null; supplier_code: string | null; case_id: string | null };
type Candidate = {
  id: string; sourceRecordKey: string; errorType: string; partNo: string | null; supplierCode: string | null; cas?: string; kind: string;
  recommendation: { state: "OK" | "NG" | "HOLD"; comment: string; reason: string }; procedureText: string; signature: string;
  eligible: boolean; inPendingQueue: boolean; draftFlow?: boolean; caution?: string; card: ReviewCard;
};
type Saved = { id: string; judge: "OK" | "NG"; comment: string; procedure: string; actor?: string | null; date?: string | null };
type Live = { given: DeckAnswers; check: AutoOutput };
type View = { card: ReviewCard; rec: Candidate["recommendation"]; decided: boolean; procedure: string; draft: boolean; caution: string };
type NeedFilter = ReviewNeed | "all";
const CHUNK = 200;
const TMC = /contact tmc|report the p\/n and supplier information to tmc/i;
const TOYOTA_FIELDS = new Set(["destination", "toleranceClass", "usCarpet", "nonEuReq"]);
/** Needs that wait on someone other than the reviewer. */
const WAITING = new Set<ReviewNeed>(["supplier", "purchasing", "tmc", "missing"]);

/** What a card shows now: the first evaluation, or the re-check after answers. */
function viewOf(c: Candidate, l: Live | undefined): View {
  if (!l) return { card: c.card, rec: c.recommendation, decided: c.eligible && (c.recommendation.state === "OK" || c.recommendation.state === "NG"), procedure: c.procedureText, draft: Boolean(c.draftFlow), caution: c.caution || "" };
  const rec = l.check.recommendation;
  const open = l.check.steps.some((s) => s.status === "NEEDS_INPUT" || s.status === "MANUAL") || Boolean(l.check.flow?.next);
  const decided = (rec.state === "OK" || rec.state === "NG") && !open && Boolean(rec.comment.trim());
  const card = classifyCase(l.check, { eligible: decided, tmcOpen: rec.state === "HOLD" && TMC.test(rec.reason), facts: {} });
  return { card: { ...card, facts: c.card.facts }, rec, decided, procedure: l.check.procedureText || c.procedureText, draft: Boolean(l.check.flow?.draft), caution: l.check.flow?.caution || c.caution || "" };
}

/**
 * Judge board: pending cases in colour-coded stacks (one per Error Type) with their statistics,
 * and a horizontal flashcard carousel for the chosen stack. On each card the decision is the
 * biggest thing; the comment window checks the wording against what was saved before for the
 * same Error Type and decision, because TMA checks it and it is typed into G-CATS as written.
 */
export function ReviewDeck({ rows, canEdit, active = true, history, onSaved, onOpenCase, onDetail, onNeeds, jump }: {
  rows: Row[]; canEdit: boolean;
  /** False while the deck is hidden behind another view: keyboard shortcuts are off. */
  active?: boolean;
  history: CommentHistory;
  onSaved: (s: Saved) => void; onOpenCase: (id: string) => void; onDetail: (part: string) => void;
  /** Pile sizes for the statistics (null while the first check runs). */
  onNeeds?: (counts: NeedCounts | null, loading: boolean) => void;
  /** Open the cards that need this (n changes on every request). */
  jump?: { need: ReviewNeed; n: number } | null;
}) {
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState("");
  const [stack, setStack] = useState<string | null>(null);
  const [needFilter, setNeedFilter] = useState<NeedFilter>("all");
  const [order, setOrder] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [live, setLive] = useState<Map<string, Live>>(new Map());
  const [comments, setComments] = useState<Map<string, string>>(new Map());
  const [working, setWorking] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<{ label: string; done: number; total: number } | null>(null);
  const [notice, setNotice] = useState("");
  const [enter, setEnter] = useState<"next" | "prev" | "up">("next");
  const liveRef = useRef(live);
  useEffect(() => { liveRef.current = live; }, [live]);
  const rowById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  const load = useCallback(async () => {
    const ids = [...new Set(rows.map((r) => r.id))];
    setLoading(true); setError(""); setProgress({ done: 0, total: ids.length });
    const all: Candidate[] = [];
    try {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const r = await fetch("/api/judgement/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "preview", ids: ids.slice(i, i + CHUNK) }) });
        const j = await r.json(); if (!r.ok) throw new Error(j.error || "Could not check the cases.");
        all.push(...(j.candidates as Candidate[]).filter((c) => c.inPendingQueue));
        setProgress({ done: Math.min(i + CHUNK, ids.length), total: ids.length });
      }
      setCands(all); setDone(new Set()); setLive(new Map()); setComments(new Map()); setOrder([]); setStack(null); setNeedFilter("all"); setIndex(0);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not check the cases."); }
    finally { setLoading(false); }
  }, [rows]);
  const loaded = useRef(false);
  useEffect(() => { if (!loaded.current && rows.length) { loaded.current = true; void load(); } }, [load, rows.length]);

  const views = useMemo(() => {
    const m = new Map<string, View>();
    for (const c of cands || []) if (!done.has(c.id)) m.set(c.id, viewOf(c, live.get(c.id)));
    return m;
  }, [cands, done, live]);
  const byId = useMemo(() => new Map((cands || []).map((c) => [c.id, c])), [cands]);
  const open = useMemo(() => (cands || []).filter((c) => views.has(c.id)), [cands, views]);
  const needCounts = useMemo(() => {
    const counts: NeedCounts = {};
    for (const c of open) { const n = views.get(c.id)!.card.need; counts[n] = (counts[n] ?? 0) + 1; }
    return counts;
  }, [open, views]);
  const stacks = useMemo<Stack[]>(() => buildStacks(open.map((c) => {
    const v = views.get(c.id)!;
    return { errorType: c.errorType, decided: v.decided, state: v.rec.state, waiting: WAITING.has(v.card.need) };
  })), [open, views]);

  useEffect(() => { onNeeds?.(cands ? needCounts : null, loading); }, [cands, needCounts, loading, onNeeds]);

  // Open the biggest stack once the cases are sorted, so the carousel is never empty on arrival.
  useEffect(() => { if (cands && stack === null && stacks.length) openStack(stacks[0].errorType); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cands, stacks.length]);

  const inStack = useMemo(() => open.filter((c) => c.errorType === stack), [open, stack]);
  const stackNeeds = useMemo(() => {
    const m = new Map<ReviewNeed, number>();
    for (const c of inStack) { const n = views.get(c.id)!.card.need; m.set(n, (m.get(n) ?? 0) + 1); }
    return m;
  }, [inStack, views]);

  // The deck keeps its order while you work in it; cards that move into the filter are added at the end.
  const deck = useMemo(() => {
    const members = inStack.filter((c) => needFilter === "all" || views.get(c.id)!.card.need === needFilter);
    const ids = new Set(members.map((c) => c.id));
    const seen = new Set(order);
    return [...order.filter((id) => ids.has(id)).map((id) => byId.get(id)!), ...members.filter((c) => !seen.has(c.id))];
  }, [inStack, needFilter, views, order, byId]);
  const pos = Math.min(index, Math.max(0, deck.length - 1));
  const current = deck[pos] || null;
  const decidedHere = deck.filter((c) => views.get(c.id)?.decided);

  function sortForDeck(list: Candidate[]) {
    // Decided cards first (a person only confirms), then the same question next to each other.
    const key = (c: Candidate) => { const v = views.get(c.id); return (v?.decided ? "0" : WAITING.has(v?.card.need ?? "manual") ? "2" : "1") + (answerKey(c, v?.card.question ?? null) || "~" + (c.partNo || "")); };
    return [...list].sort((a, b) => key(a).localeCompare(key(b)) || (a.partNo || "").localeCompare(b.partNo || ""));
  }
  function openStack(errorType: string, filter: NeedFilter = "all") {
    const members = open.filter((c) => c.errorType === errorType);
    setStack(errorType); setNeedFilter(filter); setOrder(sortForDeck(members).map((c) => c.id)); setIndex(0); setNotice(""); setEnter("next");
  }
  function pickNeed(n: NeedFilter) { setNeedFilter(n); setIndex(0); setEnter("next"); }

  const jumped = useRef(0);
  useEffect(() => {
    if (!jump || !cands || jumped.current === jump.n) return;
    jumped.current = jump.n;
    const target = stacks.find((s) => open.some((c) => c.errorType === s.errorType && views.get(c.id)?.card.need === jump.need));
    if (target) openStack(target.errorType, jump.need);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump, cands]);

  function move(to: number, dir: "next" | "prev") { setEnter(dir); setIndex(to); }

  function similarTo(c: Candidate): Candidate[] {
    const v = views.get(c.id); const k = answerKey(c, v?.card.question ?? null);
    if (!k || v?.decided) return [];
    return (cands || []).filter((x) => x.id !== c.id && views.has(x.id) && !views.get(x.id)!.decided && answerKey(x, views.get(x.id)!.card.question) === k);
  }

  async function recheck(id: string, field: string, value: string, qid: string) {
    const prev = liveRef.current.get(id)?.given ?? { answers: {} };
    const given = mergeAnswer(prev, field, value, qid);
    setWorking((w) => new Set(w).add(id));
    try {
      const check = await runCheck(id, given);
      setLive((m) => new Map(m).set(id, { given, check }));
      setComments((m) => { if (!m.has(id)) return m; const n = new Map(m); n.delete(id); return n; });
    } finally { setWorking((w) => { const n = new Set(w); n.delete(id); return n; }); }
  }

  async function answer(c: Candidate, field: string, value: string, qid: string, alsoSimilar: boolean) {
    if (!canEdit) return;
    const others = alsoSimilar ? similarTo(c) : [];
    const id = field === "answer" ? qid : field;
    setNotice(""); setError("");
    if (TOYOTA_FIELDS.has(id)) {
      const parts = new Map<string, Candidate>();
      for (const x of [c, ...others]) if (x.partNo && !parts.has(x.partNo.trim().toUpperCase())) parts.set(x.partNo.trim().toUpperCase(), x);
      for (const x of parts.values()) rememberAnswer(x.id, x.partNo, id, value);
    }
    try { await recheck(c.id, field, value, qid); }
    catch (e) { setError(e instanceof Error ? e.message : "Check failed."); return; }
    if (!others.length) return;
    setBulk({ label: "Applying the same answer", done: 0, total: others.length });
    let failed = 0; let n = 0;
    const queue = [...others];
    const worker = async () => { for (let x = queue.shift(); x; x = queue.shift()) { try { await recheck(x.id, field, value, qid); } catch { failed++; } n++; setBulk((b) => b && { ...b, done: n }); } };
    await Promise.all([worker(), worker(), worker()]);
    setBulk(null);
    setNotice(`Same answer applied to ${others.length - failed} more card${others.length - failed === 1 ? "" : "s"}.${failed ? ` ${failed} failed — open them to retry.` : ""}`);
  }

  function reset(id: string) { setLive((m) => { const n = new Map(m); n.delete(id); return n; }); setComments((m) => { const n = new Map(m); n.delete(id); return n; }); }

  async function confirmOne(c: Candidate, judge: "OK" | "NG"): Promise<Saved> {
    const v = views.get(c.id)!; const l = liveRef.current.get(c.id);
    const text = (comments.get(c.id) ?? v.rec.comment).trim();
    if (!text) throw new Error("Add the judgement comment first.");
    if (!l && c.eligible && judge === c.recommendation.state && text === c.recommendation.comment) {
      // Unchanged engine result: saved server-side with the full trace (same path as exact-match groups).
      const r = await fetch("/api/judgement/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "apply", ids: [c.id], signature: c.signature, decision: judge }) });
      const j = await r.json(); if (!r.ok || !j.succeeded) throw new Error(j.error || j.results?.[0]?.error || "Could not save.");
    } else {
      const auto = l?.check ?? await runCheck(c.id, { answers: {} });
      await saveJudgement({ itemId: c.id, caseId: rowById.get(c.id)?.case_id, auto, procedure: auto.procedureText || v.procedure, judge, comment: text });
    }
    return { id: c.id, judge, comment: text, procedure: v.procedure };
  }

  async function confirmCurrent(judge: "OK" | "NG") {
    if (!current || !canEdit || working.has(current.id)) return;
    setWorking((w) => new Set(w).add(current.id)); setError("");
    try { const s = await confirmOne(current, judge); setEnter("up"); setDone((d) => new Set(d).add(s.id)); onSaved(s); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save."); }
    finally { setWorking((w) => { const n = new Set(w); n.delete(current.id); return n; }); }
  }

  async function confirmDecided() {
    const list = decidedHere.filter((c) => !working.has(c.id));
    if (!list.length || !canEdit) return;
    const ok = list.filter((c) => views.get(c.id)!.rec.state === "OK").length;
    if (!window.confirm(`Confirm ${list.length} decided card${list.length === 1 ? "" : "s"} (${ok} OK · ${list.length - ok} NG) with the recommended result and comment?\nEach is saved with its own rule trace.`)) return;
    setError(""); setBulk({ label: "Confirming", done: 0, total: list.length });
    const failed: string[] = []; let n = 0;
    for (const c of list) {
      try { const s = await confirmOne(c, views.get(c.id)!.rec.state as "OK" | "NG"); setDone((d) => new Set(d).add(s.id)); onSaved(s); }
      catch { failed.push(c.partNo || c.sourceRecordKey); }
      n++; setBulk((b) => b && { ...b, done: n });
    }
    setBulk(null); setIndex(0);
    if (failed.length) setError(`${failed.length} not saved (changed meanwhile or missing comment): ${failed.slice(0, 5).join(", ")}${failed.length > 5 ? "…" : ""}`);
    else setNotice(`${list.length} card${list.length === 1 ? "" : "s"} confirmed.`);
  }

  if (!cands) return <section className="rd">
    <div className="rd-loading">{loading ? <><CatMascot mood="thinking" size={72}/><strong>Sorting {progress.total.toLocaleString("en-US")} cases by what they need…</strong><div className="aj-bar"><i style={{ width: (progress.total ? progress.done / progress.total * 100 : 0) + "%" }}/></div></>
      : error ? <><CatMascot mood="error" size={72}/><strong>{error}</strong><button type="button" className="rd-btn" onClick={() => void load()}><RefreshCw size={14}/> Try again</button></>
      : <><CatMascot mood="empty" size={72}/><strong>No pending cases.</strong></>}</div>
  </section>;

  const okN = decidedHere.filter((c) => views.get(c.id)?.rec.state === "OK").length;
  const sel = stacks.find((s) => s.errorType === stack) || null;

  return <section className="jb">
    <div className="jb-stacks" role="tablist" aria-label="Stacks by error type">
      {stacks.map((s) => <button type="button" role="tab" key={s.errorType} aria-selected={s.errorType === stack} title={s.errorType}
        className={"jb-stack t-" + s.tone + (s.errorType === stack ? " on" : "")} onClick={() => openStack(s.errorType)}>
        <span className="jb-orb" aria-hidden="true">{s.fullAuto ? <Sparkles size={13}/> : null}</span>
        <b className="jb-stack-n">{s.total.toLocaleString("en-US")}</b>
        <span className="jb-stack-name">{shortType(s.errorType)}</span>
        <span className="jb-stack-bar" aria-hidden="true"><i className="d" style={{ width: (s.decided / s.total) * 100 + "%" }}/><i className="y" style={{ width: (s.yours / s.total) * 100 + "%" }}/><i className="w" style={{ width: (s.waiting / s.total) * 100 + "%" }}/></span>
        <span className="jb-stack-stats"><span className="d">{s.decided} ready</span><span className="y">{s.yours} you</span><span className="w">{s.waiting} wait</span></span>
      </button>)}
    </div>

    {sel && <div className={"jb-tools t-" + sel.tone}>
      <div className="jb-needs" role="group" aria-label="Filter this stack">
        <button type="button" className={needFilter === "all" ? "on" : ""} aria-pressed={needFilter === "all"} onClick={() => pickNeed("all")}>All <b>{sel.total}</b></button>
        {NEED_ORDER.filter((n) => stackNeeds.get(n)).map((n) => <button type="button" key={n} className={(needFilter === n ? "on " : "") + "n-" + n} aria-pressed={needFilter === n} onClick={() => pickNeed(n)}>{NEED_LABEL[n].title} <b>{stackNeeds.get(n)}</b></button>)}
      </div>
      <div className="jb-tools-right">
        {decidedHere.length > 0 && canEdit && <button type="button" className="jb-confirm-all" disabled={Boolean(bulk)} onClick={() => void confirmDecided()}>
          <CheckCheck size={15}/> Confirm {decidedHere.length} <small>{okN} OK · {decidedHere.length - okN} NG</small></button>}
        <button type="button" className="jb-icon" onClick={() => void load()} disabled={loading || Boolean(bulk)} title="Check all pending cases again" aria-label="Check all pending cases again">{loading ? <LoaderCircle size={15} className="spin"/> : <RefreshCw size={15}/>}</button>
      </div>
    </div>}
    {bulk && <div className="rd-progress" role="status"><LoaderCircle size={14} className="spin"/> {bulk.label} {bulk.done}/{bulk.total}<div className="aj-bar"><i style={{ width: (bulk.done / Math.max(1, bulk.total) * 100) + "%" }}/></div></div>}
    {notice && !bulk && <div className="rd-notice" role="status"><Check size={14}/> {notice}</div>}

    {!stacks.length && <div className="fc-empty done"><CatMascot mood="success" size={84}/><strong>Nothing to judge</strong><span>Every WORKING case has a judgement.</span></div>}
    {sel && !current && <div className="fc-empty done"><CatMascot mood="success" size={84}/><strong>Stack cleared</strong><span>Pick another stack.</span></div>}
    {sel && current && <Flashcard key={current.id} active={active} c={current} v={views.get(current.id)!} pos={pos + 1} total={deck.length} left={deck.length - pos - 1} canEdit={canEdit}
        enter={enter} busy={working.has(current.id) || Boolean(bulk)} error={error} similar={similarTo(current).length} answered={live.has(current.id)} history={history}
        comment={comments.get(current.id) ?? views.get(current.id)!.rec.comment}
        onComment={(t) => setComments((m) => new Map(m).set(current.id, t))}
        onAnswer={(field, value, qid, all) => void answer(current, field, value, qid, all)}
        onConfirm={(j) => void confirmCurrent(j)} onReset={() => reset(current.id)}
        onPrev={() => move(Math.max(0, pos - 1), "prev")}
        onSkip={() => move(pos + 1 < deck.length ? pos + 1 : pos, "next")}
        onOpen={() => onOpenCase(current.id)} onDetail={() => current.partNo && onDetail(current.partNo)}/>}
  </section>;
}

/** "Prohibited substance(DBT)" → "Prohibited (DBT)": shorter stack names, same meaning. */
function shortType(t: string) { return t.replace(/^Prohibited substance\s*\(?/i, (m) => (m.includes("(") ? "Prohibited (" : "Prohibited ")).replace(/\s+/g, " ").trim(); }

const SWIPE = 90;

/**
 * One flashcard: the case on the left (part, facts, why), the decision on the right.
 * Navigation sits in the card header; drag or swipe sideways to move through the stack.
 */
function Flashcard({ active, c, v, pos, total, left, canEdit, enter, busy, error, similar, answered, history, comment, onComment, onAnswer, onConfirm, onReset, onPrev, onSkip, onOpen, onDetail }: {
  active: boolean; c: Candidate; v: View; pos: number; total: number; left: number; canEdit: boolean; enter: "next" | "prev" | "up"; busy: boolean; error: string; similar: number; answered: boolean;
  history: CommentHistory; comment: string; onComment: (t: string) => void; onAnswer: (field: string, value: string, qid: string, all: boolean) => void;
  onConfirm: (j: "OK" | "NG") => void; onReset: () => void; onPrev: () => void; onSkip: () => void; onOpen: () => void; onDetail: () => void;
}) {
  const [all, setAll] = useState(true);
  const [drag, setDrag] = useState<{ x0: number; dx: number; id: number } | null>(null);
  const q = v.decided ? null : v.card.question;
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
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowRight") { e.preventDefault(); onSkip(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); onPrev(); }
      else if (e.key === "Enter" && decision && !busy && canEdit && t?.tagName !== "BUTTON") { e.preventDefault(); onConfirm(decision as "OK" | "NG"); }
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
    <article className={"jc enter-" + enter + (drag ? " dragging" : "")} aria-live="polite" aria-busy={busy} aria-roledescription="flashcard"
      style={dx ? { transform: `translateX(${dx}px) rotate(${dx / 40}deg)` } : undefined}
      onPointerDown={(e) => { if (e.button !== 0 || interactive(e.target)) return; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setDrag({ x0: e.clientX, dx: 0, id: e.pointerId }); }}
      onPointerMove={(e) => { if (drag && e.pointerId === drag.id) setDrag({ ...drag, dx: e.clientX - drag.x0 }); }}
      onPointerUp={() => { if (!drag) return; const d = drag.dx; setDrag(null); if (d < -SWIPE) onSkip(); else if (d > SWIPE) onPrev(); }}
      onPointerCancel={() => setDrag(null)}>

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
