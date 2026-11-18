"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, Check, CheckCheck, CircleCheck, CircleDashed, CircleHelp, CircleX, Layers3, LoaderCircle, Mail, Search, ShieldCheck, Sparkles, Undo2, UserRound } from "lucide-react";
import type { AutoOutput, StepStatus } from "@/lib/judgement/auto";
import { createClient } from "@/lib/supabase/client";
import { AutoJudgeCard } from "@/components/autojudge-card";
import { DEST_CODES, regionOfCode } from "@/lib/judgement/destinations";
import { saveJudgement } from "@/lib/judgement/client-save";
import { ReviewDeck } from "@/components/review-deck";
import { JudgeStats } from "@/components/judgement-overview";
import { GcatsDetailView } from "@/components/gcats-detail-view";
import { buildCommentHistory } from "@/lib/judgement/comment-history";
import { summarizeRegister, type NeedCounts } from "@/lib/judgement/overview";
import { pileCounts, pileOf } from "@/lib/judgement/piles";
import type { ReviewNeed } from "@/lib/judgement/review";

const SYSTEM_ACTOR = "Auto-judgement (System)";
function remember(row: { id: string; delivery_part_no: string | null }, field: string, value: string) {
  if (!row.delivery_part_no || !value) return;
  void fetch("/api/judgement/memory", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: row.id, partNo: row.delivery_part_no, field, value }) }).catch(() => { /* memory is a convenience; the judgement itself is unaffected */ });
}

type Item = {
  id: string; source_record_key: string; error_type_label: string; delivery_part_no: string | null; supplier_code: string | null;
  source_status: string | null; source_year: string | null; source_month: string | null; judge: string | null; km_judge: string | null;
  source_km_judge_label: string | null; assigned_person: string | null; starting_date: string | null; judgement_procedure: string | null;
  ok_comment: string | null; imds_reject_comment: string | null; case_id: string | null; cas: string; substance_name: string;
  /** G-CATS "Comment(last time)" from the source row. */
  comment_last_time?: string;
};
type Tab = "pending" | "judged" | "km" | "kmdone";
type BulkItem = { id: string; sourceRecordKey: string; errorType: string; partNo: string | null; supplierCode: string | null; cas: string; substanceName: string; recommendation: { state: "OK" | "NG" | "HOLD"; comment: string; reason: string } };
type BulkGroup = { signature: string; decision: "OK" | "NG"; comment: string; reason: string; procedureText: string; count: number; items: BulkItem[] };
type BulkUndoItem = { id: string; decision: "OK" | "NG"; lastChangeDate: string; before: { assigned_person: string | null; starting_date: string | null; judgement_procedure: string | null; judge: null; ok_comment: string | null; imds_reject_comment: string | null } };
type BulkCoverage = { total: number; connected: number; needsReview: number; missingCas: number };
const PAGE = 80;
const DESTINATIONS: Array<[string, string]> = [["EU", "EU · Europe, Israel, Turkey"], ["KR", "Korea"], ["CN", "China"], ["TW", "Taiwan"], ["IN", "India"], ["JP", "Japan"], ["OTH", "Other"]];
const CLASSES = ["MA", "MB", "MC", "MD", "ME", "MF"];
const monthNames: Record<string, string> = { "1": "Jan", "01": "Jan", "2": "Feb", "02": "Feb", "3": "Mar", "03": "Mar", "4": "Apr", "04": "Apr", "5": "May", "05": "May", "6": "Jun", "06": "Jun", "7": "Jul", "07": "Jul", "8": "Aug", "08": "Aug", "9": "Sep", "09": "Sep", "10": "Oct", "11": "Nov", "12": "Dec" };
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());

function isProhibitedLabel(value: string) {
  const text = String(value || "").trim().toLowerCase();
  return /prohibited|restricted|regulated substance/.test(text)
    || /^(?:(?:error\s*type|no\.?)\s*)?1[4-8](?:\.0)?(?:\b|$)/.test(text);
}

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "DONE") return <CircleCheck size={15} className="jx-ok"/>;
  if (status === "NEEDS_INPUT") return <CircleDashed size={15} className="jx-input"/>;
  if (status === "MANUAL") return <AlertTriangle size={15} className="jx-warn"/>;
  return <CircleHelp size={15} className="jx-muted"/>;
}

function Chips({ options, value, onPick, label, full }: { options: Array<[string, string]>; value: string; onPick: (v: string) => void; label: string; full?: boolean }) {
  return <div className="jx-chips" role="radiogroup" aria-label={label}>{options.map(([v, text]) => <button type="button" role="radio" aria-checked={value === v} key={v} className={value === v ? "on" : ""} onClick={() => onPick(v)} title={text}>{full ? text : v}</button>)}</div>;
}

type Tmc = { key: string; status: "NEED" | "SENT" | "CONFIRMED"; answer: "OK" | "NG" | null; note: string; sentAt: string | null; answeredAt: string | null; by: string | null };
function TmcStrip({ tmc, row, canEdit, onChanged }: { tmc: Tmc; row: Item; canEdit: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState<"" | "OK" | "NG">(tmc.answer || "");
  const [note, setNote] = useState(tmc.note || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function send(action: "sent" | "answered" | "reset") {
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/judgement/escalations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: tmc.key, itemId: row.id, action, answer: answer || undefined, note }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || "Could not save.");
      setOpen(false); onChanged();
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not save."); }
    finally { setBusy(false); }
  }
  const label = tmc.status === "CONFIRMED" ? `TMC answered ${tmc.answer}${tmc.answeredAt ? " on " + tmc.answeredAt.slice(0, 10) : ""}${tmc.by ? " · recorded by " + tmc.by : ""}`
    : tmc.status === "SENT" ? `Sent to TMC${tmc.sentAt ? " on " + tmc.sentAt.slice(0, 10) : ""} · waiting for the answer` : "This flow needs TMC / TMNA / TME / TDEM confirmation";
  return <div className={"jx-tmc " + tmc.status.toLowerCase()} role="status">
    <div className="jx-tmc-line"><span className="jx-tmc-dot" aria-hidden="true"/><strong>{label}</strong>{tmc.note && tmc.status === "CONFIRMED" && <small>“{tmc.note}”</small>}</div>
    {canEdit && !open && <div className="jx-tmc-actions">
      {tmc.status === "NEED" && <button type="button" onClick={() => void send("sent")} disabled={busy}>Mark as sent to TMC</button>}
      <button type="button" onClick={() => setOpen(true)} disabled={busy}>{tmc.status === "CONFIRMED" ? "Change answer" : "Record TMC answer"}</button>
    </div>}
    {open && <div className="jx-tmc-form">
      <Chips label="TMC answer" value={answer} onPick={(v) => setAnswer(v as "OK" | "NG")} options={[["OK", "OK"], ["NG", "NG"]]}/>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What TMC said (kept as the judgement comment)" aria-label="TMC note" maxLength={1000}/>
      <button type="button" className="jx-save" onClick={() => void send("answered")} disabled={busy || !answer}>Save answer</button>
      <button type="button" className="jx-link" onClick={() => setOpen(false)}>Cancel</button>
    </div>}
    {err && <div className="jx-error" role="alert"><AlertTriangle size={13}/> {err}</div>}
    <small className="jx-hint">The answer is reused automatically for identical cases (same part, error type, CAS and flow).</small>
  </div>;
}

function JudgePanel({ row, canEdit, actorName, onSaved }: { row: Item; canEdit: boolean; actorName: string; onSaved: (id: string, patch: Partial<Item>) => void }) {
  const [destination, setDestination] = useState("");
  const [toleranceClass, setToleranceClass] = useState("");
  const [supplier, setSupplier] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [auto, setAuto] = useState<AutoOutput | null>(null);
  const [tmc, setTmc] = useState<Tmc | null>(null);
  const [rev, setRev] = useState(0);
  const reqKey = [row.id, destination, toleranceClass, supplier, JSON.stringify(answers), rev].join("|");
  const [doneKey, setDoneKey] = useState("");
  const loading = doneKey !== reqKey;
  const [judge, setJudge] = useState<"" | "OK" | "NG">(row.judge === "OK" || row.judge === "NG" ? row.judge : "");
  const [comment, setComment] = useState(row.judge === "OK" ? row.ok_comment || "" : row.judge === "NG" ? row.imds_reject_comment || "" : "");
  const [touched, setTouched] = useState(Boolean(row.judge));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    fetch("/api/judgement/auto", { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
      body: JSON.stringify({ itemId: row.id, destination: destination || undefined, toleranceClass: toleranceClass || undefined, supplierConfirmation: supplier || undefined, answers }) })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || "Automatic check failed."); setTmc((j.tmc as Tmc) || null); return j.result as AutoOutput; })
      .then((result) => {
        if (!live) return;
        setAuto(result); setError("");
        if (!toleranceClass && result.massBands && typeof result.massBands.toleranceClass === "string") setToleranceClass(result.massBands.toleranceClass);
        if (!touched && result.recommendation.state !== "HOLD") { setJudge(result.recommendation.state); setComment(result.recommendation.comment); }
      })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : "Automatic check failed."); })
      .finally(() => { if (live) setDoneKey(reqKey); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id, destination, toleranceClass, supplier, answers, rev]);

  const procedure = useMemo(() => auto?.procedureText || row.judgement_procedure || "", [auto, row.judgement_procedure]);
  const rec = auto?.recommendation;

  async function save(finalJudge: "OK" | "NG", finalComment: string) {
    if (!auto || !canEdit) return;
    setBusy(true); setError("");
    try {
      const item = await saveJudgement({ itemId: row.id, caseId: row.case_id, auto, procedure, judge: finalJudge, comment: finalComment });
      onSaved(row.id, { judge: finalJudge, ok_comment: finalJudge === "OK" ? finalComment : null, imds_reject_comment: finalJudge === "NG" ? finalComment : null,
        judgement_procedure: procedure, assigned_person: item.assigned_person ?? actorName, starting_date: item.starting_date ?? today() });
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed."); setBusy(false); }
  }

  const isAuto = row.assigned_person === SYSTEM_ACTOR && Boolean(row.judge);
  async function reopen() {
    const reason = window.prompt("Reopen this automatic decision? Give a short reason (kept in the audit log):", "");
    if (!reason || reason.trim().length < 3) return;
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/judgement/autorun", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reopen", id: row.id, reason }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || "Could not reopen.");
      onSaved(row.id, { judge: null, ok_comment: null, imds_reject_comment: null, assigned_person: null });
    } catch (e) { setError(e instanceof Error ? e.message : "Could not reopen."); setBusy(false); }
  }
  const followUp = "/follow-up?" + new URLSearchParams({ itemId: row.id, supplierCode: row.supplier_code || "", partNo: row.delivery_part_no || "", errorType: row.error_type_label });
  const ready = judge !== "" && comment.trim() !== "";
  return <div className="jx-panel">
    {isAuto ? <div className="jx-auto-line auto"><Sparkles size={13}/> Judged <strong>{row.judge}</strong> automatically by the system on <strong>{row.starting_date || today()}</strong>{canEdit && <button type="button" className="jx-link" onClick={() => void reopen()} disabled={busy}><Undo2 size={13}/> Reopen</button>}</div>
      : <div className="jx-auto-line"><UserRound size={13}/> Recorded automatically as <strong>{row.assigned_person || actorName}</strong> · <strong>{row.starting_date || today()}</strong></div>}
    <ol className="jx-steps">
      {loading && !auto && <li className="jx-loading"><LoaderCircle size={14} className="spin"/> Running the automatic checks…</li>}
      {auto?.steps.map((s) => <li key={s.id} className={"jx-step " + s.status.toLowerCase()}><StepIcon status={s.status}/><div><strong>{s.title}</strong><span>{s.detail}</span></div></li>)}
    </ol>
    {auto?.needs.destination && <div className="jx-ask"><span>Destination</span><Chips label="Destination" value={destination} onPick={(v) => { setDestination(v); if (canEdit) remember(row, "destination", v); }} options={DESTINATIONS}/>
      <select className="jx-dest-code" aria-label="Or pick the TMMIN destination code" value="" onChange={(e) => { const r = regionOfCode(e.target.value); if (r) { setDestination(r); if (canEdit) remember(row, "destination", r); } }}>
        <option value="">or pick the destination code…</option>{DEST_CODES.map(([c, label, r]) => <option key={c} value={c}>{label} → {r}</option>)}
      </select><small className="jx-hint">Remembered for this part next time.</small></div>}
    {auto?.flow?.next && auto.flow.next.id !== "destination" && <div className="jx-ask"><span>{auto.flow.next.text}</span><Chips full label={auto.flow.next.text} value="" onPick={(v) => { const id = auto.flow!.next!.id; setAnswers((a) => ({ ...a, [id]: v })); if (canEdit && (id === "usCarpet" || id === "nonEuReq")) remember(row, id, v); }} options={auto.flow.next.options}/></div>}
    {auto?.flow && Object.keys(answers).length > 0 && <div className="jx-ask"><button type="button" className="jx-link" onClick={() => setAnswers({})}>Reset flow answers</button></div>}
    {auto?.kind === "mass" && <div className="jx-ask"><span>Class (from drawing)</span><Chips label="Mass tolerance class" value={toleranceClass} onPick={(v) => { setToleranceClass(v); setSupplier(""); if (canEdit) remember(row, "toleranceClass", v); }} options={CLASSES.map((c) => [c, c] as [string, string])}/></div>}
    {auto?.needs.supplierConfirmation && <div className="jx-ask"><span>{auto.kind === "mass" ? "Outside ±10% — supplier says" : "Supplier says"}</span>
      <Chips label="Supplier confirmation" value={supplier} onPick={setSupplier} full options={auto.kind === "app44" ? [["SUPPLIER_CONFIRMED", "A · Supplier confirms the application / code"], ["INPUT_MISTAKE", "B · Input mistake"]] : [["ACTUAL_OR_CALCULATED_MASS", "A · Actual / calculated mass"], ["INPUT_MISTAKE", "B · Input mistake"]]}/>
      </div>}
    {tmc && <TmcStrip tmc={tmc} row={row} canEdit={canEdit} onChanged={() => setRev((n) => n + 1)}/>}
    {rec && <div className={"jx-rec " + rec.state.toLowerCase()}><strong>{rec.state === "HOLD" ? "Needs your judgement" : "Recommended " + rec.state}</strong><span>{rec.reason}</span></div>}
    {error && <div className="jx-error" role="alert"><AlertTriangle size={13}/> {error}</div>}
    {canEdit ? <div className="jx-decide">
      <div className="jx-judge" role="radiogroup" aria-label="Judge">
        <button type="button" role="radio" aria-checked={judge === "OK"} className={"ok " + (judge === "OK" ? "on" : "")} onClick={() => { setJudge("OK"); setTouched(true); if (rec?.state === "OK") setComment(rec.comment); }}><Check size={14}/> OK</button>
        <button type="button" role="radio" aria-checked={judge === "NG"} className={"ng " + (judge === "NG" ? "on" : "")} onClick={() => { setJudge("NG"); setTouched(true); if (rec?.state === "NG") setComment(rec.comment); }}><CircleX size={14}/> NG</button>
      </div>
      <label className="jx-comment"><span>{judge === "NG" ? "IMDS reject comment" : "Record of changing to OK"}</span>
        <textarea rows={2} value={comment} disabled={!judge} placeholder={judge ? "Required" : "Choose OK or NG first"} onChange={(e) => { setComment(e.target.value); setTouched(true); }}/></label>
      <div className="jx-actions">
        <a className="jx-link" href={followUp}><Mail size={13}/> Supplier follow-up</a>
        {row.supplier_code && <a className="jx-link" href={"/imds-tracker?supplier=" + encodeURIComponent(row.supplier_code)}><Layers3 size={13}/> Supplier in Tracker</a>}
        <button type="button" className="jx-save" disabled={!ready || busy || !auto} onClick={() => judge && void save(judge, comment.trim())}>{busy ? <LoaderCircle size={14} className="spin"/> : <ShieldCheck size={14}/>} {rec && rec.state !== "HOLD" && judge === rec.state ? "Save as recommended" : "Save judgement"}</button>
      </div>
    </div> : <div className="jx-readonly"><ShieldCheck size={14}/> Your role is read-only for judgement updates.</div>}
  </div>;
}

export function JudgementWorkspace({ rows: initialRows, year, role, actorName, sourceDate, queryError, initialSearch = "", openAutoJudgeSettings = false }: { rows: Item[]; year: number; role: string; actorName: string; sourceDate: string | null; queryError: string | null; initialSearch?: string; openAutoJudgeSettings?: boolean }) {
  const [rows, setRows] = useState(initialRows);
  const [live, setLive] = useState(false);
  useEffect(() => {
    const sb = createClient(); if (!sb) return;
    const ch = sb.channel("judgement-live").on("postgres_changes", { event: "UPDATE", schema: "public", table: "gcat_error_items" }, (p) => {
      const n = p.new as Record<string, unknown>;
      const keys = ["judge", "km_judge", "assigned_person", "starting_date", "judgement_procedure", "ok_comment", "imds_reject_comment", "last_change_date", "source_km_judge_label"];
      setRows((prev) => prev.map((r) => r.id !== n.id ? r : { ...r, ...Object.fromEntries(keys.filter((k) => k in n).map((k) => [k, n[k]])) }));
    }).subscribe((status) => setLive(status === "SUBSCRIBED"));
    return () => { void sb.removeChannel(ch); };
  }, []);
  const [tab, setTab] = useState<Tab>("pending");
  const [errorType, setErrorType] = useState("All Error Types");
  const [month, setMonth] = useState("All");
  const [search, setSearch] = useState(initialSearch);
  const [view, setView] = useState<"judge" | "list" | "detail">(initialSearch && !openAutoJudgeSettings ? "list" : "judge");
  // Auto-judge lives on the Judge table (one tab); this opens its panel.
  const [autoOpen, setAutoOpen] = useState(openAutoJudgeSettings);
  const [detailPart, setDetailPart] = useState("");
  const [needs, setNeeds] = useState<NeedCounts | null>(null);
  const [needsLoading, setNeedsLoading] = useState(true);
  const [jump, setJump] = useState<{ need: ReviewNeed; n: number } | null>(null);
  const onNeeds = useCallback((c: NeedCounts | null, loading: boolean) => { setNeeds(c); setNeedsLoading(loading); }, []);
  const openPile = useCallback((need: ReviewNeed) => { setJump((j) => ({ need, n: (j?.n ?? 0) + 1 })); setView("judge"); }, []);
  const [openId, setOpenId] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [substanceOnly, setSubstanceOnly] = useState(false);
  const [bulkGroups, setBulkGroups] = useState<BulkGroup[]>([]);
  const [bulkCoverage, setBulkCoverage] = useState<BulkCoverage | null>(null);
  const [bulkEvaluated, setBulkEvaluated] = useState(0);
  const [bulkNotFound, setBulkNotFound] = useState(0);
  const [bulkAnalyzed, setBulkAnalyzed] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState("");
  const [bulkNotice, setBulkNotice] = useState("");
  const [undoItems, setUndoItems] = useState<BulkUndoItem[]>([]);
  const canEdit = ["admin", "preparer", "reviewer"].includes(role);
  const prohibitedRows = rows.filter((row) => isProhibitedLabel(row.error_type_label));
  const prohibitedPending = prohibitedRows.filter((row) => row.source_status === "WORKING" && !row.judge).length;
  const prohibitedMissingCas = prohibitedRows.filter((row) => !row.cas?.trim()).length;

  // One definition for every count on the page (lib/judgement/piles.ts): Waiting TMA is judged, never remaining.
  const piles = useMemo(() => pileCounts(rows), [rows]);
  const counts = useMemo(() => ({ pending: piles.toJudge, judged: piles.judgedTotal, km: piles.waitingTma }), [piles]);
  // The case on top of the Waiting TMA / Judged piles: the most recently judged one.
  const pileTops = useMemo(() => {
    const latest = (k: "waitingTma" | "judged") => {
      let best: Item | null = null;
      for (const r of rows) if (pileOf(r) === k && (!best || String(r.starting_date || "") > String(best.starting_date || ""))) best = r;
      return best ? { part: best.delivery_part_no || "—", type: best.error_type_label, tag: (best.judge || "").toUpperCase() } : null;
    };
    return { waitingTma: latest("waitingTma"), judged: latest("judged") };
  }, [rows]);
  const types = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) if (r.source_status === "WORKING" && !r.judge) m.set(r.error_type_label, (m.get(r.error_type_label) || 0) + 1);
    for (const r of rows) if (!m.has(r.error_type_label)) m.set(r.error_type_label, 0);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [rows]);
  const summary = useMemo(() => summarizeRegister(rows, 6, 6), [rows]);
  const history = useMemo(() => buildCommentHistory(rows), [rows]);
  const pendingRows = useMemo(() => rows.filter((r) => pileOf(r) === "toJudge"), [rows]);
  const months = useMemo(() => [...new Set(rows.map((r) => String(r.source_month || "")).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [rows]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (tab === "pending" && (r.source_status !== "WORKING" || r.judge)) return false;
      if (tab === "judged" && !r.judge) return false;
      if (tab === "km" && pileOf(r) !== "waitingTma") return false;
      if (tab === "kmdone" && pileOf(r) !== "judged") return false;
      if (substanceOnly && !isProhibitedLabel(r.error_type_label)) return false;
      if (errorType !== "All Error Types" && r.error_type_label !== errorType) return false;
      if (month !== "All" && String(r.source_month || "") !== month) return false;
      return !q || [r.source_record_key, r.delivery_part_no, r.supplier_code, r.error_type_label, r.cas, r.substance_name].some((v) => String(v || "").toLowerCase().includes(q));
    });
  }, [rows, tab, errorType, month, search, substanceOnly]);
  const filterKey = [tab, errorType, month, search, substanceOnly].join("|");
  const [prevKey, setPrevKey] = useState(filterKey);
  if (prevKey !== filterKey) { setPrevKey(filterKey); setLimit(PAGE); setOpenId(null); }

  const onSaved = useCallback((id: string, patch: Partial<Item>) => { setRows((old) => old.map((r) => r.id === id ? { ...r, ...patch } : r)); setOpenId(null); }, []);
  async function analyzeVisibleQueue() {
    const pending = visible.filter((row) => row.source_status === "WORKING" && !row.judge);
    const selected = pending.slice(0, 250);
    if (!selected.length) { setBulkNotice("No pending records in the current filter."); setBulkGroups([]); setBulkCoverage(null); return; }
    setBulkBusy(true); setBulkError(""); setBulkNotice(""); setUndoItems([]);
    try {
      const response = await fetch("/api/judgement/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "preview", ids: selected.map((row) => row.id) }) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Bulk analysis failed.");
      setBulkGroups(json.groups as BulkGroup[]);
      setBulkCoverage(json.coverage as BulkCoverage);
      setBulkEvaluated(Number(json.evaluated || 0));
      setBulkNotFound(Number(json.notFound || 0));
      setBulkAnalyzed(true);
      setBulkNotice(`Checked ${json.evaluated} pending cases. ${(json.groups || []).length} exact-match group(s) are ready for review.${pending.length > selected.length ? ` Showing first ${selected.length} of ${pending.length}; narrow the filters to analyse the rest.` : ""}`);
    } catch (error) { setBulkError(error instanceof Error ? error.message : "Bulk analysis failed."); }
    finally { setBulkBusy(false); }
  }

  async function applyBulkGroup(group: BulkGroup) {
    const labels = group.items.slice(0, 5).map((item) => item.partNo || item.sourceRecordKey).join(", ");
    const extra = group.count > 5 ? ` and ${group.count - 5} more` : "";
    if (!window.confirm(`Review confirmed: ${group.count} cases have identical source facts and rule results. Apply the recommended ${group.decision} judgement to all?\\n\\n${labels}${extra}\\n\\nReason: ${group.reason}`)) return;
    setBulkBusy(true); setBulkError(""); setBulkNotice("");
    try {
      const response = await fetch("/api/judgement/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "apply", ids: group.items.map((item) => item.id), signature: group.signature, decision: group.decision }) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Bulk judgement could not be applied.");
      const succeeded = new Set((json.results || []).filter((item: { ok: boolean }) => item.ok).map((item: { id: string }) => item.id));
      setRows((old) => old.map((row) => !succeeded.has(row.id) ? row : { ...row, judge: group.decision,
        ok_comment: group.decision === "OK" ? group.comment : null,
        imds_reject_comment: group.decision === "NG" ? group.comment : null,
        judgement_procedure: group.procedureText }));
      setUndoItems((json.undoItems || []) as BulkUndoItem[]);
      setBulkGroups((old) => old.filter((item) => item.signature !== group.signature));
      setBulkNotice(`Saved ${json.succeeded} judgement(s). ${json.failed ? `${json.failed} case(s) were not changed and remain available for review.` : "All cases in this group were saved."} Excel sync has been queued.`);
      if (json.failed) setBulkError((json.results || []).filter((item: { ok: boolean }) => !item.ok).map((item: { error?: string }) => item.error).filter(Boolean).join(" · "));
    } catch (error) { setBulkError(error instanceof Error ? error.message : "Bulk judgement could not be applied."); }
    finally { setBulkBusy(false); }
  }

  async function undoBulk() {
    if (!undoItems.length || !window.confirm(`Undo the last bulk action for ${undoItems.length} case(s)? This is available only while those records remain unchanged.`)) return;
    setBulkBusy(true); setBulkError("");
    try {
      const response = await fetch("/api/judgement/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "undo", items: undoItems }) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Undo failed.");
      const undone = new Set((json.results || []).filter((item: { ok: boolean }) => item.ok).map((item: { id: string }) => item.id));
      const before = new Map(undoItems.map((item) => [item.id, item.before]));
      setRows((old) => old.map((row) => {
        if (!undone.has(row.id)) return row;
        const snapshot = before.get(row.id)!;
        return { ...row, judge: null, assigned_person: snapshot.assigned_person, starting_date: snapshot.starting_date,
          judgement_procedure: snapshot.judgement_procedure, ok_comment: snapshot.ok_comment, imds_reject_comment: snapshot.imds_reject_comment };
      }));
      setUndoItems((old) => old.filter((item) => !undone.has(item.id)));
      setBulkNotice(`Undid ${json.undone} judgement(s).${json.failed ? ` ${json.failed} case(s) had changed and were left untouched.` : ""}`);
    } catch (error) { setBulkError(error instanceof Error ? error.message : "Undo failed."); }
    finally { setBulkBusy(false); }
  }

  const updated = sourceDate ? new Date(sourceDate).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : null;
  const autoCount = useMemo(() => rows.filter((r) => r.judge && r.assigned_person === SYSTEM_ACTOR).length, [rows]);
  const openRow = openId ? rows.find((r) => r.id === openId) || null : null;
  const pendingInView = visible.filter((row) => row.source_status === "WORKING" && !row.judge).length;
  // After a save, go straight to the next case in the list instead of closing the panel.
  const saveAndNext = useCallback((id: string, patch: Partial<Item>) => {
    const idx = visible.findIndex((r) => r.id === id);
    const next = visible.slice(idx + 1).find((r) => r.id !== id) || null;
    onSaved(id, patch);
    setOpenId(next ? next.id : null);
  }, [visible, onSaved]);
  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenId(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId]);
  const kpis: Array<{ key: string; label: string; n: number; on: boolean; tone: string; act: () => void; hint: string }> = [
    { key: "pending", label: "To judge", n: counts.pending, on: tab === "pending" && !substanceOnly, tone: "amber", act: () => { setTab("pending"); setSubstanceOnly(false); }, hint: "WORKING cases without a judgement" },
    { key: "judged", label: "Judged", n: counts.judged, on: tab === "judged" || tab === "kmdone", tone: "green", act: () => { setTab("judged"); setSubstanceOnly(false); }, hint: "OK or NG saved" },
    { key: "km", label: "Awaiting KM", n: counts.km, on: tab === "km", tone: "blue", act: () => { setTab("km"); setSubstanceOnly(false); }, hint: "Judged, KM judge still empty" },
    { key: "sub", label: "Prohibited substances", n: prohibitedPending, on: substanceOnly, tone: "red", act: () => { setTab("pending"); setSubstanceOnly((v) => !v); setErrorType("All Error Types"); }, hint: `${prohibitedMissingCas} without CAS` },
    { key: "auto", label: "Judged by Miko", n: autoCount, on: false, tone: "violet", act: () => { setAutoOpen(true); }, hint: "Automatic decisions (reopenable)" }
  ];

  const kpiRow = <div className="jw-kpis" role="group" aria-label="Queue">
      {kpis.map((k) => <button type="button" key={k.key} className={"jw-kpi " + k.tone + (k.on && view === "list" ? " on" : "")} aria-pressed={k.on && view === "list"} onClick={() => { k.act(); setView(k.key === "auto" ? "judge" : "list"); }} title={k.hint}>
        <span>{k.label}</span><b>{k.n.toLocaleString("en-US")}</b><small>{k.hint}</small></button>)}
    </div>;

  return <div className="jw">
    <header className="jw-head">
      <div><span className="jw-kicker">WORK / JUDGEMENT</span><h1>Judgement</h1>
        <p>{year} · WORKING records{updated ? " · snapshot " + updated : ""} · <span className={live ? "jw-live on" : "jw-live"} title="Other users' judgements appear here as they are saved">{live ? "live" : "not live"}</span></p></div>
      <div className="jw-head-right">
      <div className="jw-view" role="tablist" aria-label="View">
      <button type="button" role="tab" aria-selected={view === "judge"} className={view === "judge" ? "on" : ""} onClick={() => setView("judge")}>Judge</button>
      <button type="button" role="tab" aria-selected={view === "list"} className={view === "list" ? "on" : ""} onClick={() => setView("list")}>All cases</button>
      <button type="button" role="tab" aria-selected={view === "detail"} className={view === "detail" ? "on" : ""} onClick={() => setView("detail")}>G-CATS Detail (TMA)</button>
      </div>
        <a className="jx-back" href="/workspace"><ArrowLeft size={14}/> Menu</a>
      </div>
    </header>
    {queryError && <div className="jx-error"><AlertTriangle size={14}/> {queryError}</div>}
    {rows.length === 0 && !queryError && <div className="jx-empty"><strong>No current-year source records</strong><span>Commit the current G-CATS workbook from Daily G-CATS Update to fill the queue.</span></div>}


    {view === "list" && kpiRow}
    {view === "judge" && <JudgeStats summary={summary} needs={needs} needsLoading={needsLoading} onPile={openPile}
      onKm={() => { setTab("km"); setSubstanceOnly(false); setView("list"); }}/>}
    {view === "detail" && <GcatsDetailView rows={rows} initialPart={detailPart}/>}



    {/* Stays mounted on every view: its pile counts feed the overview and a pile opens instantly. */}
    <div hidden={view !== "judge"}><ReviewDeck rows={pendingRows} piles={piles} tops={pileTops}
      autoOpen={autoOpen} onAutoToggle={setAutoOpen}
      autoJudge={<AutoJudgeCard openSettings={openAutoJudgeSettings}
      pendingIds={pendingRows.map((r) => r.id)}
      judgedIds={rows.filter((r) => r.judge && r.assigned_person !== SYSTEM_ACTOR).map((r) => r.id)}
      onFinal={(items, actor) => { const m = new Map(items.map((i) => [i.id, i.decision])); setRows((old) => old.map((r) => m.has(r.id) ? { ...r, judge: m.get(r.id)!, assigned_person: actor, starting_date: r.starting_date || today() } : r)); }}/>}
      onPile={(k) => { setTab(k === "judged" ? "kmdone" : "km"); setSubstanceOnly(false); setView("list"); }} canEdit={canEdit} active={view === "judge"} history={history} onNeeds={onNeeds} jump={jump}
      onDetail={(part) => { setDetailPart(part); setView("detail"); }}
      onOpenCase={(id) => { setView("list"); setTab("pending"); setOpenId(id); }}
      onSaved={(sv) => setRows((old) => old.map((r) => r.id === sv.id ? { ...r, judge: sv.judge, ok_comment: sv.judge === "OK" ? sv.comment : null, imds_reject_comment: sv.judge === "NG" ? sv.comment : null, judgement_procedure: sv.procedure, assigned_person: r.assigned_person || actorName, starting_date: r.starting_date || today() } : r))}/></div>

    {view === "list" && <>
    <div className="jw-tools">
      <label className="jx-search"><Search size={14}/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Part no., supplier, CAS, substance…" aria-label="Search"/></label>
      <select value={errorType} onChange={(e) => { setErrorType(e.target.value); setSubstanceOnly(false); }} aria-label="Error type">
        <option value="All Error Types">All error types</option>
        {types.map(([name, n]) => <option key={name} value={name}>{name} ({n})</option>)}
      </select>
      <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month"><option value="All">All months</option>{months.map((m) => <option key={m} value={m}>{monthNames[m] || m}</option>)}</select>
      <button type="button" className="jw-group-btn" onClick={() => void analyzeVisibleQueue()} disabled={bulkBusy || !canEdit || !pendingInView} title="Find cases with identical facts and rule results, and judge each group once">
        {bulkBusy ? <LoaderCircle size={14} className="spin"/> : <Layers3 size={14}/>} Group identical ({pendingInView.toLocaleString("en-US")})
      </button>
    </div>
    {bulkError && <div className="jx-bulk-error" role="alert"><AlertTriangle size={14}/>{bulkError}</div>}
    {bulkNotice && <div className="jx-bulk-notice"><CheckCheck size={14}/>{bulkNotice}</div>}
    {undoItems.length > 0 && <div className="jx-undo-row"><span><strong>{undoItems.length} cases</strong> changed in the last group action</span><button type="button" onClick={() => void undoBulk()} disabled={bulkBusy}><Undo2 size={14}/> Undo</button></div>}

    {bulkAnalyzed && <section className="jx-groups">
      <div className="jx-groups-heading"><div><span className="jx-command-kicker"><Layers3 size={13}/> IDENTICAL CASES</span><h2>Judge each group once</h2></div><span>{bulkGroups.length} group(s) · {bulkEvaluated} checked{bulkCoverage ? ` · ${bulkCoverage.needsReview} substance case(s) need review` : ""}{bulkNotFound ? ` · ${bulkNotFound} gone` : ""}</span></div>
      {bulkGroups.length ? bulkGroups.map((group) => <article className="jx-group" key={group.signature}>
        <div className="jx-group-top"><div><span className="jx-group-count">{group.count} identical cases</span><h3>{group.items[0]?.errorType || "Matched rule cases"}</h3></div><span className={"jx-pill " + group.decision.toLowerCase()}>Recommended {group.decision}</span></div>
        <p className="jx-group-reason">{group.reason}</p>
        {group.comment && <div className="jx-group-comment"><strong>Comment</strong><span>{group.comment}</span></div>}
        <details className="jx-group-details"><summary>Show all {group.count} cases</summary><div className="jx-group-case-list">{group.items.map((item) => <div key={item.id}><strong>{item.partNo || "Part number missing"}</strong><span>{item.supplierCode || "Supplier —"} · {item.cas || "CAS unavailable"} · {item.substanceName || item.sourceRecordKey}</span></div>)}</div></details>
        <div className="jx-group-actions"><span><ShieldCheck size={13}/> Same facts and rule trace</span><button type="button" onClick={() => void applyBulkGroup(group)} disabled={bulkBusy || !canEdit}>{bulkBusy ? <LoaderCircle size={14} className="spin"/> : <CheckCheck size={14}/>} Apply {group.decision} to all {group.count}</button></div>
      </article>) : <div className="jx-no-groups"><Layers3 size={18}/><strong>No identical groups in this view</strong><span>Cases with different facts, missing evidence or HOLD stay in the list below.</span></div>}
    </section>}

    <div className={"jw-split" + (openRow ? " open" : "")}>
      <div className="jw-table" role="region" aria-label="Cases">
        <table>
          <thead><tr><th scope="col">Part no.</th><th scope="col">Supplier</th><th scope="col">Error type</th><th scope="col" className="jw-hide-open">CAS / substance</th><th scope="col">Status</th></tr></thead>
          <tbody>
            {visible.slice(0, limit).map((r) => <tr key={r.id} className={openId === r.id ? "sel" : ""} onClick={() => setOpenId(openId === r.id ? null : r.id)}>
              <td><button type="button" className="jw-rowbtn" aria-expanded={openId === r.id} onClick={(e) => { e.stopPropagation(); setOpenId(openId === r.id ? null : r.id); }}><strong>{r.delivery_part_no || "Part number missing"}</strong></button><small>{r.source_record_key}</small></td>
              <td>{r.supplier_code || "—"}</td>
              <td><span className="jw-type">{r.error_type_label}</span></td>
              <td className="jw-hide-open">{r.cas ? <code>{r.cas}</code> : null}<small>{r.substance_name || (r.cas ? "" : "—")}</small></td>
              <td><span className={"jx-pill " + (r.judge ? r.judge.toLowerCase() : "pending")}>{r.judge ? (r.assigned_person === SYSTEM_ACTOR ? "Auto " + r.judge : r.judge) : "To judge"}</span></td>
            </tr>)}
            {!visible.length && <tr><td colSpan={5}><div className="jx-empty"><CircleHelp size={18}/><strong>No matching cases</strong><span>Change the filters or the search.</span></div></td></tr>}
          </tbody>
        </table>
        {visible.length > limit && <button type="button" className="jx-more" onClick={() => setLimit((n) => n + PAGE)}>Show {Math.min(PAGE, visible.length - limit)} more · {visible.length - limit} left</button>}
      </div>
      {openRow && <aside className="jw-drawer" aria-label={"Case " + (openRow.delivery_part_no || openRow.source_record_key)}>
        <div className="jw-drawer-head">
          <div><strong>{openRow.delivery_part_no || "Part number missing"}</strong><span>{openRow.error_type_label} · {openRow.supplier_code || "Supplier —"} · {openRow.source_record_key}</span>
            {openRow.cas && <span><code>{openRow.cas}</code> {openRow.substance_name}</span>}</div>
          <button type="button" className="jw-close" onClick={() => setOpenId(null)} aria-label="Close case"><CircleX size={18}/></button>
        </div>
        <JudgePanel key={openRow.id} row={openRow} canEdit={canEdit} actorName={actorName} onSaved={saveAndNext}/>
      </aside>}
    </div>
    </>}
    <p className="jx-gov"><ShieldCheck size={13}/> Every case is checked by the rules. Miko saves only the rule families an admin switched on; everything else is your decision. Saves are written with the evaluation trace and audit log; automatic decisions can be reopened.</p>
  </div>;
}
