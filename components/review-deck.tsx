"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Check, CheckCheck, LoaderCircle, RefreshCw, X } from "lucide-react";
import type { AutoOutput } from "@/lib/judgement/auto";
import { classifyCase, evidenceOf, NEED_LABEL, NEED_ORDER, type ReviewNeed } from "@/lib/judgement/review";
import { rememberAnswer, runCheck, saveJudgement } from "@/lib/judgement/client-save";
import { answerKey, mergeAnswer, type DeckAnswers } from "@/lib/judgement/deck";
import { CatMascot, type CatMood } from "@/components/cat-mascot";
import { CaseContext } from "@/components/case-context";
import { Decks, Piles, PILE_LABEL, type PileKind, type PileTop } from "@/components/miko-table";
import type { PileCounts } from "@/lib/judgement/piles";
import type { NeedCounts } from "@/lib/judgement/overview";
<<<<<<< HEAD
import { buildStacks, type Stack } from "@/lib/judgement/stacks";
import type { CommentHistory } from "@/lib/judgement/comment-history";
import { Flashcard, TOYOTA_FIELDS, WAITING, reducedMotion, type Candidate, type View } from "@/components/judge-flashcard";
=======
import { buildStacks, toneOf, type Stack } from "@/lib/judgement/stacks";
import { checkComment, lastComment, typeKey, type CommentHistory } from "@/lib/judgement/comment-history";
import { confirmAction, TYPE_TO_CONFIRM_FROM } from "@/components/ui/confirm-dialog";
>>>>>>> feat/ui-confirm-dialog

type Row = { id: string; source_record_key: string; error_type_label: string; delivery_part_no: string | null; supplier_code: string | null; case_id: string | null; km_judge?: string | null };
type Saved = { id: string; judge: "OK" | "NG"; comment: string; procedure: string; actor?: string | null; date?: string | null };
type Live = { given: DeckAnswers; check: AutoOutput };
type NeedFilter = ReviewNeed | "all";
const CHUNK = 200;
const TMC = /contact tmc|report the p\/n and supplier information to tmc/i;

/** What a card shows now: the first evaluation, or the re-check after answers. */
function viewOf(c: Candidate, l: Live | undefined): View {
  if (!l) return { card: c.card, rec: c.recommendation, decided: c.eligible && (c.recommendation.state === "OK" || c.recommendation.state === "NG"), procedure: c.procedureText, draft: Boolean(c.draftFlow), caution: c.caution || "", evidence: c.evidence ?? [] };
  const rec = l.check.recommendation;
  const open = l.check.steps.some((s) => s.status === "NEEDS_INPUT" || s.status === "MANUAL") || Boolean(l.check.flow?.next);
  const decided = (rec.state === "OK" || rec.state === "NG") && !open && Boolean(rec.comment.trim());
  const card = classifyCase(l.check, { eligible: decided, tmcOpen: rec.state === "HOLD" && TMC.test(rec.reason), facts: {} });
  return { card: { ...card, facts: c.card.facts }, rec, decided, procedure: l.check.procedureText || c.procedureText, draft: Boolean(l.check.flow?.draft), caution: l.check.flow?.caution || c.caution || "", evidence: evidenceOf(l.check) };
}

/**
 * Judge board: pending cases in colour-coded stacks (one per Error Type) with their statistics,
 * and a horizontal flashcard carousel for the chosen stack. On each card the decision is the
 * biggest thing; the comment window checks the wording against what was saved before for the
 * same Error Type and decision, because TMA checks it and it is typed into G-CATS as written.
 */
export function ReviewDeck({ rows, canEdit, active = true, history, onSaved, onOpenCase, onDetail, onNeeds, jump, piles, onPile, tops, autoJudge, autoOpen = false, onAutoToggle }: {
  /** Case on top of the Waiting TMA / Judged piles. */
  tops?: Partial<Record<PileKind, PileTop>>;
  /** The Auto-judge panel (shown on the table when open). */
  autoJudge?: React.ReactNode; autoOpen?: boolean; onAutoToggle?: (open: boolean) => void;
  rows: Row[]; canEdit: boolean;
  /** Real pile counts from the register (lib/judgement/piles.ts). */
  piles: PileCounts;
  /** Open the records of the Waiting TMA or Judged pile (read-only list). */
  onPile: (kind: "waitingTma" | "judged") => void;
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
  const [help, setHelp] = useState(false);
  const [bulkDone, setBulkDone] = useState(false);
  const [comments, setComments] = useState<Map<string, string>>(new Map());
  const [working, setWorking] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<{ label: string; done: number; total: number } | null>(null);
  const [notice, setNotice] = useState("");
  const [enter, setEnter] = useState<"next" | "prev" | "up">("next");
  const [stamp, setStamp] = useState<{ id: string; decision: "OK" | "NG" } | null>(null);
  const [bump, setBump] = useState<PileKind | null>(null);
  const [, setCheer] = useState(0);
  const [cheerOn, setCheerOn] = useState(false);
  const pileRefs = useRef<Partial<Record<PileKind, HTMLButtonElement | null>>>({});
  const cardRef = useRef<HTMLElement | null>(null);
  const deckRefs = useRef<Record<string, HTMLButtonElement | null>>({});
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
    const c = current;
    setWorking((w) => new Set(w).add(c.id)); setError("");
    try {
      const s = await confirmOne(c, judge);
      // Saved on the server: stamp the card, then send it to the pile its real status belongs to.
      const to: PileKind = rowById.get(c.id)?.km_judge ? "judged" : "waitingTma";
      setStamp({ id: c.id, decision: judge });
      await flyToPile(to);
      setStamp(null); setEnter("up"); setDone((d) => new Set(d).add(s.id)); onSaved(s);
      setBump(to); setCheer((n) => n + 1); setCheerOn(true);
      window.setTimeout(() => setBump(null), 700); window.setTimeout(() => setCheerOn(false), 1600);
      setNotice(`${c.partNo || "Case"} judged ${judge} — moved to ${PILE_LABEL[to].title}.`);
    }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save."); }
    finally { setWorking((w) => { const n = new Set(w); n.delete(c.id); return n; }); }
  }

  /** Card flies into a pile. Only called after the save succeeded; skipped with reduced motion. */
  async function flyToPile(to: PileKind) {
    const card = cardRef.current; const pile = pileRefs.current[to];
    if (!card || !pile || reducedMotion()) { await wait(250); return; }
    await wait(420);
    const a = card.getBoundingClientRect(); const b = pile.getBoundingClientRect();
    const dx = b.left + b.width / 2 - (a.left + a.width / 2); const dy = b.top + b.height / 2 - (a.top + a.height / 2);
    const k = Math.max(0.1, Math.min(0.35, b.width / a.width));
    card.style.willChange = "transform, opacity";
    try { await card.animate([
      { transform: "translate3d(0,0,0) scale(1) rotate(0)", opacity: 1 },
      { transform: `translate3d(${dx * 0.55}px, ${dy * 0.55 - 40}px, 0) scale(${(1 + k) / 2}) rotate(4deg)`, opacity: 0.9, offset: 0.55 },
      { transform: `translate3d(${dx}px, ${dy}px, 0) scale(${k}) rotate(8deg)`, opacity: 0 }],
      { duration: 620, easing: "cubic-bezier(.45,0,.25,1)", fill: "forwards" }).finished; } catch { /* element removed */ }
  }

  async function confirmDecided() {
    const list = decidedHere.filter((c) => !working.has(c.id));
    if (!list.length || !canEdit) return;
    const ok = list.filter((c) => views.get(c.id)!.rec.state === "OK").length;
    if (!(await confirmAction({
      title: `Confirm ${list.length} decided card${list.length === 1 ? "" : "s"}?`,
      body: `${ok} OK · ${list.length - ok} NG, each with its recommended comment. Each is saved with its own rule trace.`,
      confirmLabel: `Confirm ${list.length}`,
      typeToConfirm: list.length >= TYPE_TO_CONFIRM_FROM ? String(list.length) : undefined
    }))) return;
    setError(""); setBulk({ label: "Confirming", done: 0, total: list.length });
    const failed: string[] = []; let n = 0;
    for (const c of list) {
      try { const s = await confirmOne(c, views.get(c.id)!.rec.state as "OK" | "NG"); setDone((d) => new Set(d).add(s.id)); onSaved(s); setBump(rowById.get(c.id)?.km_judge ? "judged" : "waitingTma"); }
      catch { failed.push(c.partNo || c.sourceRecordKey); }
      n++; setBulk((b) => b && { ...b, done: n });
    }
    setBulk(null); setIndex(0); setCheer((x) => x + 1); setBulkDone(true); setCheerOn(true); window.setTimeout(() => { setBump(null); }, 700); window.setTimeout(() => { setCheerOn(false); setBulkDone(false); }, 2200);
    if (failed.length) setError(`${failed.length} not saved (changed meanwhile or missing comment): ${failed.slice(0, 5).join(", ")}${failed.length > 5 ? "…" : ""}`);
    else setNotice(`${list.length} card${list.length === 1 ? "" : "s"} confirmed.`);
  }

  const okN = decidedHere.filter((c) => views.get(c.id)?.rec.state === "OK").length;
  const sel = stacks.find((s) => s.errorType === stack) || null;
  const toJudge = cands ? open.length : piles.toJudge;
  const curView = current ? views.get(current.id) : undefined;
  const mood: CatMood = error ? "error"
    : loading ? "thinking"
    : bulk || stamp || (current && working.has(current.id)) ? "working"
    : cheerOn && bulkDone ? "celebrate"
    : cheerOn ? "success"
    : cands && !open.length ? "celebrate"
    : curView && !curView.decided && WAITING.has(curView.card.need) ? "waiting"
    : curView && curView.draft ? "alert"
    : "idle";
  const say = !cands ? (loading ? [`Miko is sorting ${progress.total.toLocaleString("en-US")} cases…`, "Checking every unjudged case against the rules"] : error ? ["Miko could not deal the cards", error] : ["Nothing to deal", "Every WORKING case has a judgement."])
    : !open.length ? ["All unjudged cases have been processed", "Judged cards wait in Waiting TMA until TMA/KM is filled."]
    : stamp ? [`Judged ${stamp.decision} — saved`, "Moving the card to its pile…"]
    : current && sel ? [current && views.get(current.id)?.decided ? "Ready to confirm" : "Next case is ready", `${sel.errorType} · ${deck.length} in this deck · ${toJudge.toLocaleString("en-US")} to judge`]
    : sel ? ["Stack cleared", "Pick another stack."] : ["Miko is ready to deal", `${toJudge.toLocaleString("en-US")} cases to judge`];

  return <section className="mt" aria-label="Miko's judgement table">
    <header className="mt-dealer">
      <span className="mt-miko"><button type="button" className="mt-miko-btn" onClick={() => setHelp((v) => !v)} aria-expanded={help} aria-controls="mt-help" aria-label={`Miko: ${say[0]}. Show status and shortcuts`}><CatMascot mood={mood} size={62}/></button></span>
      {help && <div className="mt-help" id="mt-help" role="dialog" aria-label="Miko — status and shortcuts" onKeyDown={(e) => { if (e.key === "Escape") setHelp(false); }}>
        <button type="button" className="mt-help-x" onClick={() => setHelp(false)} aria-label="Close"><X size={14}/></button>
        <h3>{say[0]}</h3><p>{say[1]}</p>
        <dl>
          <dt>To judge</dt><dd>WORKING cases with no judgement yet.</dd>
          <dt>Waiting TMA</dt><dd>Judged here; TMA/KM judge still empty. Not counted as remaining work.</dd>
          <dt>Judged</dt><dd>Judged and TMA/KM done.</dd>
        </dl>
        <dl>
          <dt><kbd>→</kbd> <kbd>←</kbd></dt><dd>Next / previous card</dd>
          <dt><kbd>1</kbd>–<kbd>9</kbd></dt><dd>Answer the card&apos;s question</dd>
          <dt><kbd>Enter</kbd></dt><dd>Confirm a decided card (only while focus is on the table)</dd>
          <dt><kbd>Ctrl</kbd> <kbd>K</kbd></dt><dd>Jump anywhere, search a part</dd>
        </dl>
        <p>A card is saved only after the server confirms; a failed save leaves it where it was.</p>
      </div>}
      <div className="mt-say" aria-live="polite"><strong>{say[0]}</strong><span>{say[1]}</span>
        {loading && <div className="aj-bar"><i style={{ width: (progress.total ? progress.done / progress.total * 100 : 0) + "%" }}/></div>}</div>
      <Piles piles={piles} toJudge={toJudge} active="toJudge" bump={bump} refs={pileRefs}
        tops={{ ...tops, toJudge: current ? { part: current.partNo || "—", type: current.errorType } : null }}
        onPile={(k) => { if (k === "toJudge") { if (stacks[0] && !stack) openStack(stacks[0].errorType); } else onPile(k); }}/>
      <div className="mt-dealer-actions">
        {autoJudge && <button type="button" className={"mt-btn" + (autoOpen ? " on" : "")} aria-expanded={autoOpen} onClick={() => onAutoToggle?.(!autoOpen)}><Bot size={15}/> Auto-judge</button>}
        {decidedHere.length > 0 && canEdit && <button type="button" className="jb-confirm-all" disabled={Boolean(bulk)} onClick={() => void confirmDecided()}>
          <CheckCheck size={15}/> Confirm {decidedHere.length} <small>{okN} OK · {decidedHere.length - okN} NG</small></button>}
        <button type="button" className="mt-icon" onClick={() => void load()} disabled={loading || Boolean(bulk)} title="Check all pending cases again" aria-label="Check all pending cases again">{loading ? <LoaderCircle size={15} className="spin"/> : <RefreshCw size={15}/>}</button>
      </div>
    </header>

    {autoJudge && autoOpen && <div className="mt-auto-panel mt-auto">{autoJudge}</div>}
    <div className="mt-board">
      <div className="mt-play">
        {stacks.length > 0 && <Decks stacks={stacks} selected={stack} onPick={(t) => openStack(t)} label={shortType} refs={deckRefs}/>}
        {sel && <div className={"jb-needs t-" + sel.tone} role="group" aria-label="Filter this stack">
          <button type="button" className={needFilter === "all" ? "on" : ""} aria-pressed={needFilter === "all"} onClick={() => pickNeed("all")}>All <b>{sel.total}</b></button>
          {NEED_ORDER.filter((n) => stackNeeds.get(n)).map((n) => <button type="button" key={n} className={(needFilter === n ? "on " : "") + "n-" + n} aria-pressed={needFilter === n} onClick={() => pickNeed(n)}>{NEED_LABEL[n].title} <b>{stackNeeds.get(n)}</b></button>)}
        </div>}
        {bulk && <div className="rd-progress" role="status"><LoaderCircle size={14} className="spin"/> {bulk.label} {bulk.done}/{bulk.total}<div className="aj-bar"><i style={{ width: (bulk.done / Math.max(1, bulk.total) * 100) + "%" }}/></div></div>}
        {notice && !bulk && <div className="rd-notice" role="status"><Check size={14}/> {notice}</div>}
        {!cands && error && <button type="button" className="mt-retry" onClick={() => void load()}><RefreshCw size={14}/> Try again</button>}
        {cands && !open.length && <div className="mt-slot done"><CatMascot mood="success" size={64}/><strong>All unjudged cases are done</strong><span>Open Waiting TMA or Judged to review them.</span></div>}
        {sel && !current && open.length > 0 && <div className="mt-slot done"><strong>Stack cleared</strong><span>Pick another rule family above.</span></div>}
        {!cands && loading && <div className="mt-slot"><span className="mt-slot-card" aria-hidden="true"/><strong>Shuffling the deck…</strong></div>}
        {sel && current && <Flashcard key={current.id} cardRef={cardRef} dealFrom={() => (stack && deckRefs.current[stack]) ? deckRefs.current[stack]!.getBoundingClientRect() : pileRefs.current.toJudge?.getBoundingClientRect() ?? null} stamp={stamp?.id === current.id ? stamp.decision : null}
          active={active} c={current} v={views.get(current.id)!} pos={pos + 1} total={deck.length} left={deck.length - pos - 1} canEdit={canEdit}
          enter={enter} busy={working.has(current.id) || Boolean(bulk)} error={error} similar={similarTo(current).length} answered={live.has(current.id)} history={history}
          comment={comments.get(current.id) ?? views.get(current.id)!.rec.comment}
          onComment={(t) => setComments((m) => new Map(m).set(current.id, t))}
          onAnswer={(field, value, qid, all) => void answer(current, field, value, qid, all)}
          onConfirm={(j) => void confirmCurrent(j)} onReset={() => reset(current.id)}
          onPrev={() => move(Math.max(0, pos - 1), "prev")}
          onSkip={() => move(pos + 1 < deck.length ? pos + 1 : pos, "next")}
          onOpen={() => onOpenCase(current.id)} onDetail={() => current.partNo && onDetail(current.partNo)}/>}
      </div>
      {sel && current && <CaseContext key={current.id} itemId={current.id} partNo={current.partNo} check={live.get(current.id)?.check ?? null}/>}
    </div>
  </section>;
}

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

/** "Prohibited substance(DBT)" → "Prohibited (DBT)": shorter stack names, same meaning. */
function shortType(t: string) { return t.replace(/^Prohibited substance\s*\(?/i, (m) => (m.includes("(") ? "Prohibited (" : "Prohibited ")).replace(/\s+/g, " ").trim(); }
