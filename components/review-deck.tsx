"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCheck, CircleX, ExternalLink, FileWarning, LoaderCircle, RefreshCw, RotateCcw } from "lucide-react";
import type { AutoOutput } from "@/lib/judgement/auto";
import { classifyCase, NEED_LABEL, NEED_ORDER, type ReviewCard, type ReviewNeed } from "@/lib/judgement/review";
import { rememberAnswer, runCheck, saveJudgement } from "@/lib/judgement/client-save";
import { answerKey, mergeAnswer, type DeckAnswers } from "@/lib/judgement/deck";
import { CatMascot } from "@/components/cat-mascot";

type Row = { id: string; source_record_key: string; error_type_label: string; delivery_part_no: string | null; supplier_code: string | null; case_id: string | null };
type Candidate = {
  id: string; sourceRecordKey: string; errorType: string; partNo: string | null; supplierCode: string | null; cas?: string; kind: string;
  recommendation: { state: "OK" | "NG" | "HOLD"; comment: string; reason: string }; procedureText: string; signature: string;
  eligible: boolean; inPendingQueue: boolean; draftFlow?: boolean; caution?: string; card: ReviewCard;
};
type Saved = { id: string; judge: "OK" | "NG"; comment: string; procedure: string; actor?: string | null; date?: string | null };
type Live = { given: DeckAnswers; check: AutoOutput };
type View = { card: ReviewCard; rec: Candidate["recommendation"]; decided: boolean; procedure: string; draft: boolean; caution: string };
const CHUNK = 200;
const TMC = /contact tmc|report the p\/n and supplier information to tmc/i;
const TOYOTA_FIELDS = new Set(["destination", "toleranceClass", "usCarpet", "nonEuReq"]);

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
 * Review deck: pending cases grouped by what they still need, one card at a time.
 * One answer moves every card with the same question (same part for vehicle questions,
 * same supplier + part + CAS for supplier questions). Cards the rules then decide are confirmed
 * one by one (Enter) or together. Keys 1–9 answer · Enter confirm · ← → move · swipe on phones.
 */
export function ReviewDeck({ rows, canEdit, onSaved, onOpenCase }: { rows: Row[]; canEdit: boolean; onSaved: (s: Saved) => void; onOpenCase: (id: string) => void }) {
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState("");
  const [need, setNeed] = useState<ReviewNeed | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [live, setLive] = useState<Map<string, Live>>(new Map());
  const [comments, setComments] = useState<Map<string, string>>(new Map());
  const [working, setWorking] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<{ label: string; done: number; total: number } | null>(null);
  const [notice, setNotice] = useState("");
  const liveRef = useRef(live);
  useEffect(() => { liveRef.current = live; }, [live]);
  const rowById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  const load = useCallback(async () => {
    const ids = rows.map((r) => r.id);
    setLoading(true); setError(""); setProgress({ done: 0, total: ids.length });
    const all: Candidate[] = [];
    try {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const r = await fetch("/api/judgement/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "preview", ids: ids.slice(i, i + CHUNK) }) });
        const j = await r.json(); if (!r.ok) throw new Error(j.error || "Could not check the cases.");
        all.push(...(j.candidates as Candidate[]).filter((c) => c.inPendingQueue));
        setProgress({ done: Math.min(i + CHUNK, ids.length), total: ids.length });
      }
      setCands(all); setDone(new Set()); setLive(new Map()); setComments(new Map()); setOrder([]); setNeed(null); setIndex(0);
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
  const groups = useMemo(() => {
    const g = new Map<ReviewNeed, Candidate[]>();
    for (const c of cands || []) { const v = views.get(c.id); if (!v) continue; const list = g.get(v.card.need) ?? []; list.push(c); g.set(v.card.need, list); }
    return g;
  }, [cands, views]);

  // The pile keeps its order while you work in it (answered cards stay where they were);
  // cards that move into the pile meanwhile are added at the end.
  const deck = useMemo(() => {
    if (!need) return [] as Candidate[];
    const members = groups.get(need) ?? [];
    const seen = new Set(order);
    return [...order.filter((id) => views.has(id)).map((id) => byId.get(id)!).filter(Boolean), ...members.filter((c) => !seen.has(c.id))];
  }, [need, order, groups, views, byId]);
  const pos = Math.min(index, Math.max(0, deck.length - 1));
  const current = deck[pos] || null;
  const decidedHere = deck.filter((c) => views.get(c.id)?.decided);

  function openPile(n: ReviewNeed) {
    const members = [...(groups.get(n) ?? [])];
    // Same question next to each other: answer one, the rest follow.
    const key = (c: Candidate) => answerKey(c, views.get(c.id)?.card.question ?? null) || "~" + (c.partNo || "");
    members.sort((a, b) => key(a).localeCompare(key(b)) || (a.partNo || "").localeCompare(b.partNo || ""));
    setNeed(n); setOrder(members.map((c) => c.id)); setIndex(0); setNotice("");
  }

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
    try { const s = await confirmOne(current, judge); setDone((d) => new Set(d).add(s.id)); onSaved(s); }
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
  return <section className="rd">
    <div className="rd-groups" role="tablist" aria-label="What the cases need">
      {NEED_ORDER.map((n) => { const count = groups.get(n)?.length || 0; return <button type="button" role="tab" key={n} aria-selected={need === n} className={"rd-group n-" + n + (need === n ? " on" : "")} disabled={!count && need !== n} onClick={() => openPile(n)}>
        <b>{count.toLocaleString("en-US")}</b><span>{NEED_LABEL[n].title}</span></button>; })}
      <button type="button" className="rd-refresh" onClick={() => void load()} disabled={loading || Boolean(bulk)} title="Check all pending cases again">{loading ? <LoaderCircle size={14} className="spin"/> : <RefreshCw size={14}/>}</button>
    </div>
    {need && decidedHere.length > 1 && canEdit && <div className="rd-bar">
      <span><b>{decidedHere.length}</b> card{decidedHere.length === 1 ? "" : "s"} in this pile {need === "ready" ? "are" : "are now"} decided · {okN} OK · {decidedHere.length - okN} NG</span>
      <button type="button" className="rd-all" disabled={Boolean(bulk)} onClick={() => void confirmDecided()}><CheckCheck size={15}/> Confirm all {decidedHere.length}</button>
    </div>}
    {bulk && <div className="rd-progress" role="status"><LoaderCircle size={14} className="spin"/> {bulk.label} {bulk.done}/{bulk.total}<div className="aj-bar"><i style={{ width: (bulk.done / Math.max(1, bulk.total) * 100) + "%" }}/></div></div>}
    {notice && !bulk && <div className="rd-notice" role="status"><Check size={14}/> {notice}</div>}
    {!need && <div className="rd-hint"><CatMascot mood="idle" size={56}/><div><strong>Pick a pile.</strong><span>Every pending case is sorted by the one thing it still needs. One answer moves every card with the same question — vehicle answers are remembered for the part.</span></div></div>}
    {need && !current && <div className="rd-hint"><CatMascot mood="success" size={56}/><div><strong>This pile is done.</strong><span>Pick another pile above.</span></div></div>}
    {need && current && <Flashcard key={current.id} c={current} v={views.get(current.id)!} pos={pos + 1} total={deck.length} canEdit={canEdit}
      busy={working.has(current.id) || Boolean(bulk)} error={error} similar={similarTo(current).length} answered={live.has(current.id)}
      comment={comments.get(current.id) ?? views.get(current.id)!.rec.comment}
      onComment={(t) => setComments((m) => new Map(m).set(current.id, t))}
      onAnswer={(field, value, qid, all) => void answer(current, field, value, qid, all)}
      onConfirm={(j) => void confirmCurrent(j)} onReset={() => reset(current.id)}
      onPrev={() => setIndex(Math.max(0, pos - 1))}
      onSkip={() => setIndex(pos + 1 < deck.length ? pos + 1 : pos)}
      onOpen={() => onOpenCase(current.id)}/>}
  </section>;
}

function Flashcard({ c, v, pos, total, canEdit, busy, error, similar, answered, comment, onComment, onAnswer, onConfirm, onReset, onPrev, onSkip, onOpen }: {
  c: Candidate; v: View; pos: number; total: number; canEdit: boolean; busy: boolean; error: string; similar: number; answered: boolean;
  comment: string; onComment: (t: string) => void; onAnswer: (field: string, value: string, qid: string, all: boolean) => void;
  onConfirm: (j: "OK" | "NG") => void; onReset: () => void; onPrev: () => void; onSkip: () => void; onOpen: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [all, setAll] = useState(true);
  const touch = useRef<number | null>(null);
  const q = v.decided ? null : v.card.question;
  const pile = c.card.need;

  // Keyboard: 1–9 answer, Enter confirm, ← back, → skip.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (e.key === "ArrowRight") { e.preventDefault(); onSkip(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); onPrev(); }
      else if (e.key === "Enter" && v.decided && !busy) { e.preventDefault(); onConfirm(v.rec.state as "OK" | "NG"); }
      else if (/^[1-9]$/.test(e.key) && q && !busy) { const o = q.options[Number(e.key) - 1]; if (o) { e.preventDefault(); onAnswer(q.field, o[0], q.id, all); } }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return <article className={"rd-card n-" + pile} aria-live="polite" aria-busy={busy}
    onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
    onTouchEnd={(e) => { const s = touch.current; touch.current = null; if (s === null) return; const dx = e.changedTouches[0].clientX - s; if (dx < -70) onSkip(); else if (dx > 70) onPrev(); }}>
    <header className="rd-card-head">
      <span className="rd-pile">{NEED_LABEL[pile].title}{answered && v.card.need !== pile ? <em> → {NEED_LABEL[v.card.need].title}</em> : null}</span>
      <span className="rd-pos">{pos} / {total}</span>
    </header>
    <div className="rd-id"><strong>{c.partNo || "Part number missing"}</strong><span>{c.errorType} · {c.supplierCode || "Supplier —"} · {c.sourceRecordKey}</span></div>
    {c.card.facts.length > 0 && <dl className="rd-facts">{c.card.facts.map(([k, val]) => <div key={k}><dt>{k}</dt><dd>{val}</dd></div>)}</dl>}
    {v.draft && <div className="rd-draft"><FileWarning size={14}/> {v.caution || "Draft flow in the source. A person confirms it — the system never finalises it."}</div>}

    {q && <div className="rd-q">
      <p>{q.text}</p>
      <div className="rd-opts">{q.options.map(([val, label], i) => <button type="button" key={val} disabled={busy || !canEdit} onClick={() => onAnswer(q.field, val, q.id, all)}><kbd>{i + 1}</kbd>{label}</button>)}</div>
      {similar > 0 && canEdit && <label className="rd-same"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)}/> Same answer for <b>{similar}</b> more card{similar === 1 ? "" : "s"} with this question ({TOYOTA_FIELDS.has(q.field === "answer" ? q.id : q.field) ? "same part" : "same supplier, part and CAS"})</label>}
      {NEED_LABEL[v.card.need].hint && <small>{NEED_LABEL[v.card.need].hint}</small>}
    </div>}

    {v.decided ? <div className={"rd-rec " + v.rec.state.toLowerCase()}>
      <strong>{v.rec.state === "OK" ? <Check size={16}/> : <CircleX size={16}/>} Recommended {v.rec.state}</strong>
      <span>{v.rec.reason}</span>
      {editing ? <textarea rows={2} value={comment} onChange={(e) => onComment(e.target.value)} aria-label="Judgement comment"/> : <button type="button" className="rd-comment" onClick={() => setEditing(true)} title="Edit the comment">“{comment || "Add a comment"}” <small>edit</small></button>}
    </div> : !q && <div className="rd-rec hold"><strong><AlertTriangle size={16}/> {NEED_LABEL[v.card.need].title}</strong><span>{v.card.reason}</span></div>}

    {error && <div className="jx-error" role="alert"><AlertTriangle size={13}/> {error}</div>}
    <footer className="rd-actions">
      <button type="button" className="rd-nav" onClick={onPrev} aria-label="Previous card"><ArrowLeft size={16}/></button>
      {v.decided && canEdit ? <button type="button" className={"rd-confirm " + v.rec.state.toLowerCase()} disabled={busy} onClick={() => onConfirm(v.rec.state as "OK" | "NG")}>
        {busy ? <LoaderCircle size={16} className="spin"/> : <Check size={16}/>} Confirm {v.rec.state}</button>
        : <button type="button" className="rd-open" onClick={onOpen}>{busy ? <LoaderCircle size={15} className="spin"/> : <ExternalLink size={15}/>} Open full case</button>}
      <button type="button" className="rd-nav" onClick={onSkip} aria-label="Skip to next card"><ArrowRight size={16}/></button>
    </footer>
    <div className="rd-foot">
      {answered && canEdit && <button type="button" className="rd-link" disabled={busy} onClick={onReset}><RotateCcw size={12}/> Change answers</button>}
      {v.decided && <button type="button" className="rd-link" onClick={onOpen}><ExternalLink size={12}/> Judge differently</button>}
      <span className="rd-keys">1–9 answer · Enter confirm · ← → move · swipe on phone</span>
    </div>
  </article>;
}
