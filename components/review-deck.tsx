"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCheck, CircleX, ExternalLink, LoaderCircle, RefreshCw } from "lucide-react";
import type { AutoOutput } from "@/lib/judgement/auto";
import { classifyCase, NEED_LABEL, NEED_ORDER, type ReviewCard, type ReviewNeed } from "@/lib/judgement/review";
import { rememberAnswer, runCheck, saveJudgement } from "@/lib/judgement/client-save";
import { CatMascot } from "@/components/cat-mascot";

type Row = { id: string; source_record_key: string; error_type_label: string; delivery_part_no: string | null; supplier_code: string | null; case_id: string | null };
type Candidate = {
  id: string; sourceRecordKey: string; errorType: string; partNo: string | null; supplierCode: string | null; kind: string;
  recommendation: { state: "OK" | "NG" | "HOLD"; comment: string; reason: string }; procedureText: string; signature: string;
  eligible: boolean; inPendingQueue: boolean; card: ReviewCard;
};
type Saved = { id: string; judge: "OK" | "NG"; comment: string; procedure: string; actor?: string | null; date?: string | null };
type Answers = { destination?: string; toleranceClass?: string; supplierConfirmation?: string; answers: Record<string, string> };
const CHUNK = 200;
const TOYOTA_FIELDS = new Set(["destination", "toleranceClass", "usCarpet", "nonEuReq"]);

/**
 * Review deck: pending cases grouped by what they still need, one card at a time.
 * Answer with one tap (or keys 1–9), confirm with one tap (or Enter), skip with → or a swipe.
 */
export function ReviewDeck({ rows, canEdit, onSaved, onOpenCase }: { rows: Row[]; canEdit: boolean; onSaved: (s: Saved) => void; onOpenCase: (id: string) => void }) {
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState("");
  const [need, setNeed] = useState<ReviewNeed | null>(null);
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState<Set<string>>(new Set());

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
      setCands(all); setDone(new Set());
    } catch (e) { setError(e instanceof Error ? e.message : "Could not check the cases."); }
    finally { setLoading(false); }
  }, [rows]);
  const loaded = useRef(false);
  useEffect(() => { if (!loaded.current && rows.length) { loaded.current = true; void load(); } }, [load, rows.length]);

  const groups = useMemo(() => {
    const g = new Map<ReviewNeed, Candidate[]>();
    for (const c of cands || []) { if (done.has(c.id)) continue; const list = g.get(c.card.need) ?? []; list.push(c); g.set(c.card.need, list); }
    return g;
  }, [cands, done]);
  const deck = need ? groups.get(need) ?? [] : [];
  const current = deck[Math.min(index, Math.max(0, deck.length - 1))] || null;

  function finish(id: string) { setDone((d) => new Set(d).add(id)); }

  if (!cands) return <section className="rd">
    <div className="rd-loading">{loading ? <><CatMascot mood="thinking" size={72}/><strong>Sorting {progress.total.toLocaleString("en-US")} cases by what they need…</strong><div className="aj-bar"><i style={{ width: (progress.total ? progress.done / progress.total * 100 : 0) + "%" }}/></div></>
      : error ? <><CatMascot mood="error" size={72}/><strong>{error}</strong><button type="button" className="rd-btn" onClick={() => void load()}><RefreshCw size={14}/> Try again</button></>
      : <><CatMascot mood="empty" size={72}/><strong>No pending cases.</strong></>}</div>
  </section>;

  return <section className="rd">
    <div className="rd-groups" role="tablist" aria-label="What the cases need">
      {NEED_ORDER.map((n) => { const count = groups.get(n)?.length || 0; return <button type="button" role="tab" key={n} aria-selected={need === n} className={"rd-group n-" + n + (need === n ? " on" : "")} disabled={!count} onClick={() => { setNeed(n); setIndex(0); }}>
        <b>{count.toLocaleString("en-US")}</b><span>{NEED_LABEL[n].title}</span></button>; })}
      <button type="button" className="rd-refresh" onClick={() => void load()} disabled={loading} title="Check all pending cases again">{loading ? <LoaderCircle size={14} className="spin"/> : <RefreshCw size={14}/>}</button>
    </div>
    {!need && <div className="rd-hint"><CatMascot mood="idle" size={56}/><div><strong>Pick a pile.</strong><span>Every pending case is sorted by the one thing it still needs. Answer it once per card — answers about the vehicle are remembered for the part.</span></div></div>}
    {need && !current && <div className="rd-hint"><CatMascot mood="success" size={56}/><div><strong>This pile is done.</strong><span>Pick another pile above.</span></div></div>}
    {need && current && <Flashcard key={current.id} c={current} row={rows.find((r) => r.id === current.id)!} pos={index + 1} total={deck.length} canEdit={canEdit}
      onPrev={() => setIndex((i) => Math.max(0, i - 1))}
      onSkip={() => setIndex((i) => (i + 1 < deck.length ? i + 1 : i))}
      onOpen={() => onOpenCase(current.id)}
      onSaved={(s) => { finish(s.id); onSaved(s); setIndex((i) => Math.min(i, Math.max(0, deck.length - 2))); }}
      readyAll={need === "ready" ? deck : null}
      onSavedMany={(list) => { list.forEach((s) => { finish(s.id); onSaved(s); }); setIndex(0); }}/>}
  </section>;
}

function Flashcard({ c, row, pos, total, canEdit, onPrev, onSkip, onOpen, onSaved, readyAll, onSavedMany }: {
  c: Candidate; row: Row; pos: number; total: number; canEdit: boolean;
  onPrev: () => void; onSkip: () => void; onOpen: () => void; onSaved: (s: Saved) => void;
  readyAll: Candidate[] | null; onSavedMany: (list: Saved[]) => void;
}) {
  const [given, setGiven] = useState<Answers>({ answers: {} });
  const [check, setCheck] = useState<AutoOutput | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [comment, setComment] = useState(c.recommendation.comment);
  const [editing, setEditing] = useState(false);
  const touch = useRef<number | null>(null);

  // What is on the card now: the original evaluation, or the re-check after an answer.
  const rec = check ? check.recommendation : c.recommendation;
  const openStep = check ? check.steps.find((s) => s.status === "NEEDS_INPUT" || s.status === "MANUAL") : null;
  const decided = (rec.state === "OK" || rec.state === "NG") && (check ? !openStep && !check.flow?.next : c.eligible);
  // After an answer, the re-check decides the next question with the same sorting rules as the piles.
  const liveCard = check ? classifyCase(check, { eligible: decided, tmcOpen: false, facts: {} }) : c.card;
  const nextQ = liveCard.question;
  const procedure = check ? check.procedureText : c.procedureText;

  async function answer(field: string, value: string, qid: string) {
    if (!canEdit) return;
    const next: Answers = { ...given, answers: { ...given.answers } };
    if (field === "destination") next.destination = value;
    else if (field === "toleranceClass") next.toleranceClass = value;
    else if (field === "supplierConfirmation") next.supplierConfirmation = value;
    else next.answers[qid] = value;
    setGiven(next); setBusy(true); setError("");
    if (TOYOTA_FIELDS.has(field === "answer" ? qid : field)) rememberAnswer(row.id, row.delivery_part_no, field === "answer" ? qid : field, value);
    try { const r = await runCheck(row.id, next); setCheck(r); setComment(r.recommendation.comment); }
    catch (e) { setError(e instanceof Error ? e.message : "Check failed."); }
    finally { setBusy(false); }
  }

  async function confirm(judge: "OK" | "NG") {
    if (!canEdit || busy) return;
    const text = comment.trim();
    if (!text) { setEditing(true); setError("Add the judgement comment first."); return; }
    setBusy(true); setError("");
    try {
      if (!check && c.eligible && judge === c.recommendation.state && text === c.recommendation.comment) {
        // Unchanged engine result: save server-side with the full trace (same path as exact-match groups).
        const r = await fetch("/api/judgement/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "apply", ids: [c.id], signature: c.signature, decision: judge }) });
        const j = await r.json(); if (!r.ok || !j.succeeded) throw new Error(j.error || (j.results?.[0]?.error) || "Could not save.");
      } else {
        const auto = check ?? await runCheck(row.id, given);
        await saveJudgement({ itemId: row.id, caseId: row.case_id, auto, procedure: auto.procedureText || procedure, judge, comment: text });
      }
      onSaved({ id: c.id, judge, comment: text, procedure });
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save."); setBusy(false); }
  }

  async function confirmAll() {
    if (!readyAll || !canEdit) return;
    if (!window.confirm(`Confirm all ${readyAll.length} cases in this pile with the recommended OK/NG and comment?\nEach is saved with its own rule trace.`)) return;
    setBusy(true); setError("");
    const saved: Saved[] = []; const failed: string[] = [];
    for (const x of readyAll) {
      if (x.recommendation.state !== "OK" && x.recommendation.state !== "NG") continue;
      try {
        const r = await fetch("/api/judgement/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "apply", ids: [x.id], signature: x.signature, decision: x.recommendation.state }) });
        const j = await r.json(); if (!r.ok || !j.succeeded) throw new Error(j.error || j.results?.[0]?.error || "failed");
        saved.push({ id: x.id, judge: x.recommendation.state, comment: x.recommendation.comment, procedure: x.procedureText });
      } catch { failed.push(x.partNo || x.sourceRecordKey); }
    }
    setBusy(false);
    if (failed.length) setError(`${failed.length} not saved (changed meanwhile): ${failed.slice(0, 5).join(", ")}${failed.length > 5 ? "…" : ""}`);
    onSavedMany(saved);
  }

  // Keyboard: 1–9 answer, Enter confirm, ← back, → skip.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (e.key === "ArrowRight") { e.preventDefault(); onSkip(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); onPrev(); }
      else if (e.key === "Enter" && decided) { e.preventDefault(); void confirm(rec.state as "OK" | "NG"); }
      else if (/^[1-9]$/.test(e.key) && nextQ && !decided) { const o = nextQ.options[Number(e.key) - 1]; if (o) { e.preventDefault(); void answer(nextQ.field, o[0], nextQ.id); } }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const need = c.card.need;
  return <article className={"rd-card n-" + need} aria-live="polite"
    onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
    onTouchEnd={(e) => { const s = touch.current; touch.current = null; if (s === null) return; const dx = e.changedTouches[0].clientX - s; if (dx < -70) onSkip(); else if (dx > 70) onPrev(); }}>
    <header className="rd-card-head">
      <span className="rd-pile">{NEED_LABEL[need].title}</span>
      <span className="rd-pos">{pos} / {total}</span>
    </header>
    <div className="rd-id"><strong>{c.partNo || "Part number missing"}</strong><span>{c.errorType} · {c.supplierCode || "Supplier —"} · {c.sourceRecordKey}</span></div>
    {c.card.facts.length > 0 && <dl className="rd-facts">{c.card.facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}

    {!decided && nextQ && <div className="rd-q">
      <p>{nextQ.text}</p>
      <div className="rd-opts">{nextQ.options.map(([v, label], i) => <button type="button" key={v} disabled={busy || !canEdit} className={(given.answers[nextQ.id] || given.destination || given.toleranceClass || given.supplierConfirmation) === v ? "on" : ""} onClick={() => void answer(nextQ.field, v, nextQ.id)}><kbd>{i + 1}</kbd>{label}</button>)}</div>
      {NEED_LABEL[need].hint && <small>{NEED_LABEL[need].hint}</small>}
    </div>}

    {decided ? <div className={"rd-rec " + rec.state.toLowerCase()}>
      <strong>{rec.state === "OK" ? <Check size={16}/> : <CircleX size={16}/>} Recommended {rec.state}</strong>
      <span>{rec.reason}</span>
      {editing ? <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} aria-label="Judgement comment"/> : <button type="button" className="rd-comment" onClick={() => setEditing(true)} title="Edit the comment">“{comment || "Add a comment"}” <small>edit</small></button>}
    </div> : !nextQ && <div className="rd-rec hold"><strong><AlertTriangle size={16}/> {NEED_LABEL[liveCard.need].title}</strong><span>{liveCard.reason}</span></div>}

    {error && <div className="jx-error" role="alert"><AlertTriangle size={13}/> {error}</div>}
    <footer className="rd-actions">
      <button type="button" className="rd-nav" onClick={onPrev} aria-label="Previous card"><ArrowLeft size={16}/></button>
      {decided && canEdit ? <button type="button" className={"rd-confirm " + rec.state.toLowerCase()} disabled={busy} onClick={() => void confirm(rec.state as "OK" | "NG")}>
        {busy ? <LoaderCircle size={16} className="spin"/> : <Check size={16}/>} Confirm {rec.state}</button>
        : <button type="button" className="rd-open" onClick={onOpen}><ExternalLink size={15}/> Open full case</button>}
      <button type="button" className="rd-nav" onClick={onSkip} aria-label="Skip to next card"><ArrowRight size={16}/></button>
    </footer>
    {readyAll && readyAll.length > 1 && canEdit && <button type="button" className="rd-all" disabled={busy} onClick={() => void confirmAll()}><CheckCheck size={15}/> Confirm all {readyAll.length} in this pile</button>}
    <p className="rd-keys">Keys: 1–9 answer · Enter confirm · ← → move · swipe on phone</p>
  </article>;
}
