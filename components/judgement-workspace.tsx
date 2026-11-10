"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, Check, CheckCheck, ChevronDown, CircleCheck, CircleDashed, CircleHelp, CircleX, Clock3, Layers3, LoaderCircle, Mail, ScanSearch, Search, ShieldCheck, Sparkles, Undo2, UserRound } from "lucide-react";
import type { AutoOutput, StepStatus } from "@/lib/judgement/auto";
import { createClient } from "@/lib/supabase/client";

type Item = {
  id: string; source_record_key: string; error_type_label: string; delivery_part_no: string | null; supplier_code: string | null;
  source_status: string | null; source_year: string | null; source_month: string | null; judge: string | null; km_judge: string | null;
  source_km_judge_label: string | null; assigned_person: string | null; starting_date: string | null; judgement_procedure: string | null;
  ok_comment: string | null; imds_reject_comment: string | null; case_id: string | null; cas: string; substance_name: string;
};
type Tab = "pending" | "judged" | "km";
type BulkItem = {
  id: string; sourceRecordKey: string; errorType: string; partNo: string | null; supplierCode: string | null;
  cas: string; substanceName: string; kind: AutoOutput["kind"];
  recommendation: { state: "OK" | "NG" | "HOLD"; comment: string; reason: string };
  procedureText: string; signature: string; eligible: boolean; inPendingQueue: boolean; prohibited: boolean;
  prohibitedStatus: "CONNECTED" | "NEEDS_REVIEW" | "NOT_PROHIBITED"; reviewReason: string;
};
type BulkGroup = { signature: string; decision: "OK" | "NG"; comment: string; reason: string; procedureText: string; count: number; items: BulkItem[] };
type BulkUndoItem = { id: string; decision: "OK" | "NG"; lastChangeDate: string; before: { assigned_person: string | null; starting_date: string | null; judgement_procedure: string | null; judge: null; ok_comment: string | null; imds_reject_comment: string | null } };
type BulkCoverage = { total: number; connected: number; needsReview: number; missingCas: number };
const PAGE = 80;
const BULK_API_LIMIT = 250;
function chunkItems<T>(items: T[], size = BULK_API_LIMIT): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}
function mergeExactMatchGroups(candidates: BulkItem[]): BulkGroup[] {
  const grouped = new Map<string, BulkItem[]>();
  for (const item of candidates) {
    if (!item.eligible || !item.inPendingQueue || !item.signature
      || (item.recommendation.state !== "OK" && item.recommendation.state !== "NG")) continue;
    const current = grouped.get(item.signature) ?? [];
    current.push(item);
    grouped.set(item.signature, current);
  }
  return [...grouped.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([signature, items]) => {
      const first = items[0];
      const consistent = items.every((item) =>
        item.recommendation.state === first.recommendation.state
        && item.recommendation.comment === first.recommendation.comment
        && item.recommendation.reason === first.recommendation.reason
        && item.procedureText === first.procedureText
      );
      return consistent ? {
        signature, decision: first.recommendation.state as "OK" | "NG",
        comment: first.recommendation.comment, reason: first.recommendation.reason,
        procedureText: first.procedureText, count: items.length, items
      } : null;
    })
    .filter((group): group is BulkGroup => group !== null)
    .sort((a, b) => b.count - a.count);
}
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

function JudgePanel({ row, canEdit, actorName, onSaved }: { row: Item; canEdit: boolean; actorName: string; onSaved: (id: string, patch: Partial<Item>) => void }) {
  const [destination, setDestination] = useState("");
  const [toleranceClass, setToleranceClass] = useState("");
  const [supplier, setSupplier] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [auto, setAuto] = useState<AutoOutput | null>(null);
  const reqKey = [row.id, destination, toleranceClass, supplier, JSON.stringify(answers)].join("|");
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
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || "Automatic check failed."); return j.result as AutoOutput; })
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
  }, [row.id, destination, toleranceClass, supplier, answers]);

  const procedure = useMemo(() => auto?.procedureText || row.judgement_procedure || "", [auto, row.judgement_procedure]);
  const rec = auto?.recommendation;

  async function save(finalJudge: "OK" | "NG", finalComment: string) {
    if (!auto || !canEdit) return;
    setBusy(true); setError("");
    try {
      const trace = await fetch("/api/judgement/evaluate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...auto.engineInput, caseId: row.case_id || undefined }) });
      const traceJson = await trace.json();
      if (!trace.ok) throw new Error(traceJson.error || "Could not record the evaluation trace.");
      const res = await fetch("/api/register/" + row.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        judgement_procedure: procedure, judge: finalJudge,
        ok_comment: finalJudge === "OK" ? finalComment : null, imds_reject_comment: finalJudge === "NG" ? finalComment : null }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not save the judgement.");
      const item = json.item as Partial<Item> | undefined;
      onSaved(row.id, { judge: finalJudge, ok_comment: finalJudge === "OK" ? finalComment : null, imds_reject_comment: finalJudge === "NG" ? finalComment : null,
        judgement_procedure: procedure, assigned_person: item?.assigned_person ?? actorName, starting_date: item?.starting_date ?? today() });
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed."); setBusy(false); }
  }

  const followUp = "/follow-up?" + new URLSearchParams({ itemId: row.id, supplierCode: row.supplier_code || "", partNo: row.delivery_part_no || "", errorType: row.error_type_label });
  const ready = judge !== "" && comment.trim() !== "";
  return <div className="jx-panel">
    <div className="jx-auto-line"><UserRound size={13}/> Recorded automatically as <strong>{row.assigned_person || actorName}</strong> · <strong>{row.starting_date || today()}</strong></div>
    <ol className="jx-steps">
      {loading && !auto && <li className="jx-loading"><LoaderCircle size={14} className="spin"/> Running the automatic checks…</li>}
      {auto?.steps.map((s) => <li key={s.id} className={"jx-step " + s.status.toLowerCase()}><StepIcon status={s.status}/><div><strong>{s.title}</strong><span>{s.detail}</span></div></li>)}
    </ol>
    {auto?.needs.destination && <div className="jx-ask"><span>Destination</span><Chips label="Destination" value={destination} onPick={setDestination} options={DESTINATIONS}/></div>}
    {auto?.flow?.next && auto.flow.next.id !== "destination" && <div className="jx-ask"><span>{auto.flow.next.text}</span><Chips full label={auto.flow.next.text} value="" onPick={(v) => setAnswers((a) => ({ ...a, [auto.flow!.next!.id]: v }))} options={auto.flow.next.options}/></div>}
    {auto?.flow && Object.keys(answers).length > 0 && <div className="jx-ask"><button type="button" className="jx-link" onClick={() => setAnswers({})}>Reset flow answers</button></div>}
    {auto?.kind === "mass" && <div className="jx-ask"><span>Class (from drawing)</span><Chips label="Mass tolerance class" value={toleranceClass} onPick={(v) => { setToleranceClass(v); setSupplier(""); }} options={CLASSES.map((c) => [c, c] as [string, string])}/></div>}
    {auto?.needs.supplierConfirmation && <div className="jx-ask"><span>{auto.kind === "mass" ? "Outside ±10% — supplier says" : "Supplier says"}</span>
      <Chips label="Supplier confirmation" value={supplier} onPick={setSupplier} full options={auto.kind === "app44" ? [["SUPPLIER_CONFIRMED", "A · Supplier confirms the application / code"], ["INPUT_MISTAKE", "B · Input mistake"]] : [["ACTUAL_OR_CALCULATED_MASS", "A · Actual / calculated mass"], ["INPUT_MISTAKE", "B · Input mistake"]]}/>
      </div>}
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
        <button type="button" className="jx-save" disabled={!ready || busy || !auto} onClick={() => judge && void save(judge, comment.trim())}>{busy ? <LoaderCircle size={14} className="spin"/> : <ShieldCheck size={14}/>} {rec && rec.state !== "HOLD" && judge === rec.state ? "Save as recommended" : "Save judgement"}</button>
      </div>
    </div> : <div className="jx-readonly"><ShieldCheck size={14}/> Your role is read-only for judgement updates.</div>}
  </div>;
}

export function JudgementWorkspace({ rows: initialRows, year, role, actorName, sourceDate, queryError }: { rows: Item[]; year: number; role: string; actorName: string; sourceDate: string | null; queryError: string | null }) {
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
  const [search, setSearch] = useState("");
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

  const counts = useMemo(() => ({
    pending: rows.filter((r) => r.source_status === "WORKING" && !r.judge).length,
    judged: rows.filter((r) => !!r.judge).length,
    km: rows.filter((r) => !!r.judge && !r.km_judge).length
  }), [rows]);
  const types = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) if (r.source_status === "WORKING" && !r.judge) m.set(r.error_type_label, (m.get(r.error_type_label) || 0) + 1);
    for (const r of rows) if (!m.has(r.error_type_label)) m.set(r.error_type_label, 0);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [rows]);
  const months = useMemo(() => [...new Set(rows.map((r) => String(r.source_month || "")).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [rows]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (tab === "pending" && (r.source_status !== "WORKING" || r.judge)) return false;
      if (tab === "judged" && !r.judge) return false;
      if (tab === "km" && (!r.judge || r.km_judge)) return false;
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
    if (!pending.length) {
      setBulkNotice("No pending records in the current filter.");
      setBulkGroups([]); setBulkCoverage(null); setBulkEvaluated(0); setBulkNotFound(0); setBulkAnalyzed(true);
      return;
    }
    const batches = chunkItems(pending);
    setBulkBusy(true); setBulkError(""); setBulkNotice(""); setBulkGroups([]); setBulkCoverage(null);
    setBulkEvaluated(0); setBulkNotFound(0); setBulkAnalyzed(false); setUndoItems([]);
    try {
      const allCandidates: BulkItem[] = [];
      const coverage: BulkCoverage = { total: 0, connected: 0, needsReview: 0, missingCas: 0 };
      let evaluated = 0;
      let notFound = 0;
      for (let index = 0; index < batches.length; index += 1) {
        setBulkNotice(`Analysing batch ${index + 1} of ${batches.length} · ${Math.min((index + 1) * BULK_API_LIMIT, pending.length)} of ${pending.length} cases checked.`);
        const response = await fetch("/api/judgement/bulk", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "preview", ids: batches[index].map((row) => row.id) })
        });
        const json = await response.json();
        if (!response.ok) throw new Error(`Batch ${index + 1}/${batches.length}: ${json.error || "Bulk analysis failed."}`);
        if (!Array.isArray(json.candidates)) throw new Error(`Batch ${index + 1}/${batches.length}: the server did not return the full candidate list.`);
        allCandidates.push(...json.candidates as BulkItem[]);
        evaluated += Number(json.evaluated || 0);
        notFound += Number(json.notFound || 0);
        coverage.total += Number(json.coverage?.total || 0);
        coverage.connected += Number(json.coverage?.connected || 0);
        coverage.needsReview += Number(json.coverage?.needsReview || 0);
        coverage.missingCas += Number(json.coverage?.missingCas || 0);
      }
      const groups = mergeExactMatchGroups(allCandidates);
      setBulkGroups(groups); setBulkCoverage(coverage); setBulkEvaluated(evaluated); setBulkNotFound(notFound); setBulkAnalyzed(true);
      setBulkNotice(`Completed analysis of ${evaluated.toLocaleString("en-US")} pending cases. ${groups.length} exact-match group(s) are ready for review.${notFound ? ` ${notFound} case(s) were not found and need a fresh queue check.` : ""}`);
    } catch (error) {
      setBulkAnalyzed(false);
      setBulkGroups([]); setBulkCoverage(null);
      setBulkError(error instanceof Error ? error.message : "Bulk analysis failed.");
      setBulkNotice("Analysis was not completed. No bulk judgement was applied; correct the issue and analyse the queue again.");
    } finally { setBulkBusy(false); }
  }

  async function applyBulkGroup(group: BulkGroup) {
    const labels = group.items.slice(0, 5).map((item) => item.partNo || item.sourceRecordKey).join(", ");
    const extra = group.count > 5 ? ` and ${group.count - 5} more` : "";
    if (!window.confirm(`Review confirmed: ${group.count} cases have identical source facts and rule results. Apply the recommended ${group.decision} judgement to all?\n\n${labels}${extra}\n\nReason: ${group.reason}`)) return;
    const batches = chunkItems(group.items);
    setBulkBusy(true); setBulkError(""); setBulkNotice("");
    const allUndo: BulkUndoItem[] = [];
    const failures: string[] = [];
    let succeeded = 0;
    let failed = 0;
    try {
      for (let index = 0; index < batches.length; index += 1) {
        setBulkNotice(`Applying judgement · batch ${index + 1} of ${batches.length}.`);
        try {
          const response = await fetch("/api/judgement/bulk", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "apply", ids: batches[index].map((item) => item.id), signature: group.signature, decision: group.decision })
          });
          const json = await response.json();
          if (!response.ok) {
            failed += batches[index].length;
            failures.push(`Batch ${index + 1}: ${json.error || "Bulk judgement could not be applied."}`);
            continue;
          }
          const successfulIds = new Set((json.results || []).filter((item: { ok: boolean }) => item.ok).map((item: { id: string }) => item.id));
          succeeded += Number(json.succeeded || successfulIds.size);
          failed += Number(json.failed || 0);
          allUndo.push(...(json.undoItems || []) as BulkUndoItem[]);
          setRows((old) => old.map((row) => !successfulIds.has(row.id) ? row : { ...row, judge: group.decision,
            ok_comment: group.decision === "OK" ? group.comment : null,
            imds_reject_comment: group.decision === "NG" ? group.comment : null,
            judgement_procedure: group.procedureText }));
          for (const item of (json.results || []) as Array<{ok:boolean;error?:string}>) {
            if (!item.ok && item.error) failures.push(item.error);
          }
        } catch (error) {
          failed += batches[index].length;
          failures.push(`Batch ${index + 1}: ${error instanceof Error ? error.message : "Network error"}`);
          break;
        }
      }
      setUndoItems(allUndo);
      setBulkGroups((old) => old.filter((item) => item.signature !== group.signature));
      setBulkNotice(`Saved ${succeeded.toLocaleString("en-US")} of ${group.count.toLocaleString("en-US")} judgements. ${failed ? `${failed} case(s) were not saved and remain in the pending queue.` : "All cases in this group were saved."} Excel sync has been queued.`);
      if (failures.length) setBulkError([...new Set(failures)].join(" · "));
    } finally { setBulkBusy(false); }
  }

  async function undoBulk() {
    if (!undoItems.length || !window.confirm(`Undo the last bulk action for ${undoItems.length} case(s)? This is available only while those records remain unchanged.`)) return;
    const batches = chunkItems(undoItems);
    setBulkBusy(true); setBulkError(""); setBulkNotice("");
    const remaining = new Map(undoItems.map((item) => [item.id, item]));
    const errors: string[] = [];
    let undoneCount = 0;
    try {
      for (let index = 0; index < batches.length; index += 1) {
        setBulkNotice(`Undoing bulk judgement · batch ${index + 1} of ${batches.length}.`);
        try {
          const response = await fetch("/api/judgement/bulk", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "undo", items: batches[index] })
          });
          const json = await response.json();
          if (!response.ok) {
            errors.push(`Batch ${index + 1}: ${json.error || "Undo failed."}`);
            continue;
          }
          const undone = new Set((json.results || []).filter((item: { ok: boolean }) => item.ok).map((item: { id: string }) => item.id));
          const before = new Map(batches[index].map((item) => [item.id, item.before]));
          setRows((old) => old.map((row) => {
            if (!undone.has(row.id)) return row;
            const snapshot = before.get(row.id)!;
            return { ...row, judge: null, assigned_person: snapshot.assigned_person, starting_date: snapshot.starting_date,
              judgement_procedure: snapshot.judgement_procedure, ok_comment: snapshot.ok_comment, imds_reject_comment: snapshot.imds_reject_comment };
          }));
          undone.forEach((id) => remaining.delete(id));
          undoneCount += Number(json.undone || undone.size);
          for (const item of (json.results || []) as Array<{ok:boolean;error?:string}>) {
            if (!item.ok && item.error) errors.push(item.error);
          }
        } catch (error) {
          errors.push(`Batch ${index + 1}: ${error instanceof Error ? error.message : "Network error"}`);
          break;
        }
      }
      setUndoItems([...remaining.values()]);
      setBulkNotice(`Undid ${undoneCount.toLocaleString("en-US")} judgement(s).${remaining.size ? ` ${remaining.size} case(s) could not be undone and remain available for retry.` : ""}`);
      if (errors.length) setBulkError([...new Set(errors)].join(" · "));
    } finally { setBulkBusy(false); }
  }

  const updated = sourceDate ? new Date(sourceDate).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : null;

  return <div className="jx">
    <header className="jx-head">
      <div><h1>Judgement</h1><p>{year} · WORKING records{updated ? " · snapshot " + updated : ""} · <span title="Other users' judgements appear here as they are saved">{live ? "● live" : "○ not live"}</span></p></div>
      <a className="jx-back" href="/workspace"><ArrowLeft size={14}/> Menu</a>
    </header>
    {queryError && <div className="jx-error"><AlertTriangle size={14}/> {queryError}</div>}
    {rows.length === 0 && !queryError && <div className="jx-empty"><strong>No current-year source records</strong><span>Commit the current G-CATS workbook from Daily G-CATS Update to fill the queue.</span></div>}

    <section className="jx-command">
      <div className="jx-command-head">
        <div><span className="jx-command-kicker"><Sparkles size={13}/> SMART JUDGEMENT</span>
          <h2>Review identical cases together</h2>
          <p>Analyse the pending queue, compare complete source facts and rule traces, then apply one reviewed recommendation to an exact-match group.</p>
        </div>
        <button type="button" className="jx-analyze" onClick={() => void analyzeVisibleQueue()} disabled={bulkBusy || !canEdit}>
          {bulkBusy ? <LoaderCircle size={15} className="spin"/> : <ScanSearch size={15}/>} Analyse pending cases
        </button>
      </div>
      <div className="jx-command-metrics">
        <div><span>Pending in filter</span><strong>{visible.filter((row) => row.source_status === "WORKING" && !row.judge).length.toLocaleString("en-US")}</strong></div>
        <div><span>Exact-match groups</span><strong>{bulkGroups.length.toLocaleString("en-US")}</strong></div>
        <div><span>Prohibited cases</span><strong>{prohibitedRows.length.toLocaleString("en-US")}</strong><small>{prohibitedPending} pending · {prohibitedMissingCas} without CAS</small></div>
        <div><span>Queue connection</span><strong>{live ? "Live" : "Sync pending"}</strong><small>{rows.length.toLocaleString("en-US")} source records loaded</small></div>
      </div>
      {bulkError && <div className="jx-bulk-error" role="alert"><AlertTriangle size={14}/>{bulkError}</div>}
      {bulkNotice && <div className="jx-bulk-notice"><CheckCheck size={14}/>{bulkNotice}</div>}
      {bulkAnalyzed && <div className="jx-coverage">
        <div><strong>Prohibited substance coverage</strong><span>{bulkCoverage?.connected || 0} connected · {bulkCoverage?.needsReview || 0} need review · {bulkCoverage?.missingCas || 0} missing CAS</span></div>
        <div className="jx-coverage-meta">{bulkEvaluated} analysed{bulkNotFound ? ` · ${bulkNotFound} no longer available` : ""}</div>
      </div>}
      {undoItems.length > 0 && <div className="jx-undo-row"><span><strong>{undoItems.length} cases</strong> changed in the last bulk action</span><button type="button" onClick={() => void undoBulk()} disabled={bulkBusy}><Undo2 size={14}/> Undo bulk action</button></div>}
    </section>

    {bulkAnalyzed && <section className="jx-groups">
      <div className="jx-groups-heading"><div><span className="jx-command-kicker"><Layers3 size={13}/> MATCHED GROUPS</span><h2>Bulk judgement review</h2></div><span>{bulkGroups.length} group(s)</span></div>
      {bulkGroups.length ? bulkGroups.map((group) => <article className="jx-group" key={group.signature}>
        <div className="jx-group-top"><div><span className="jx-group-count">{group.count} identical cases</span><h3>{group.items[0]?.errorType || "Matched rule cases"}</h3></div><span className={"jx-pill " + group.decision.toLowerCase()}>Recommended {group.decision}</span></div>
        <p className="jx-group-reason">{group.reason}</p>
        {group.comment && <div className="jx-group-comment"><strong>Recommended judgement comment</strong><span>{group.comment}</span></div>}
        <details className="jx-group-details"><summary>Review all {group.count} cases and source identifiers</summary><div className="jx-group-case-list">{group.items.map((item) => <div key={item.id}><strong>{item.partNo || "Part number missing"}</strong><span>{item.supplierCode || "Supplier —"} · {item.cas || "CAS unavailable"} · {item.substanceName || item.sourceRecordKey}</span></div>)}</div></details>
        <div className="jx-group-actions"><span><ShieldCheck size={13}/> Exact facts + rule trace match · human confirmation required</span><button type="button" onClick={() => void applyBulkGroup(group)} disabled={bulkBusy || !canEdit}>{bulkBusy ? <LoaderCircle size={14} className="spin"/> : <CheckCheck size={14}/>} Apply {group.decision} to all {group.count}</button></div>
      </article>) : <div className="jx-no-groups"><Layers3 size={18}/><strong>No safe exact-match groups found</strong><span>Cases with missing evidence, different material facts or HOLD recommendations remain in individual review. Nothing was judged automatically.</span></div>}
    </section>}

    <nav className="jx-tabs" aria-label="Queue">
      {([["pending", "To judge", counts.pending], ["judged", "Judged", counts.judged], ["km", "Awaiting KM", counts.km]] as const).map(([k, label, n]) =>
        <button type="button" key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{label}<b>{n.toLocaleString("en-US")}</b></button>)}
    </nav>

    <div className="jx-filters">
      <label className="jx-search"><Search size={14}/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Part no., supplier, CAS, substance…" aria-label="Search"/></label>
      <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month"><option value="All">All months</option>{months.map((m) => <option key={m} value={m}>{monthNames[m] || m}</option>)}</select>
    </div>
    <div className="jx-types" role="group" aria-label="Error type">
      <button type="button" className={!substanceOnly && errorType === "All Error Types" ? "on" : ""} onClick={() => { setErrorType("All Error Types"); setSubstanceOnly(false); }}>All</button><button type="button" className={"jx-prohibited-filter " + (substanceOnly ? "on" : "")} onClick={() => { setSubstanceOnly((value) => !value); setErrorType("All Error Types"); }}>Prohibited substances <b>{prohibitedPending}</b></button>
      {types.map(([name, n]) => <button type="button" key={name} className={errorType === name ? "on" : ""} onClick={() => setErrorType(errorType === name ? "All Error Types" : name)}><span>{name}</span><b>{n}</b></button>)}
    </div>

    <ul className="jx-list">
      {visible.slice(0, limit).map((r) => {
        const open = openId === r.id;
        return <li key={r.id} className={"jx-row " + (open ? "open" : "")}>
          <button type="button" className="jx-row-head" aria-expanded={open} onClick={() => setOpenId(open ? null : r.id)}>
            <span className={"jx-state " + (r.judge ? "done" : "pending")}>{r.judge ? <Check size={13}/> : <Clock3 size={13}/>}</span>
            <span className="jx-main"><strong>{r.delivery_part_no || "Part number missing"}</strong><small>{r.error_type_label} · {r.supplier_code || "Supplier —"} · {r.source_record_key}</small></span>
            <span className="jx-sub">{r.cas ? <><code>{r.cas}</code><small>{r.substance_name}</small></> : <small>{r.substance_name || "—"}</small>}</span>
            <span className={"jx-pill " + (r.judge ? r.judge.toLowerCase() : "pending")}>{r.judge || "Pending"}</span>
            <ChevronDown size={16} className="jx-chev"/>
          </button>
          {open && <JudgePanel row={r} canEdit={canEdit} actorName={actorName} onSaved={onSaved}/>}
        </li>;
      })}
      {!visible.length && <li className="jx-empty"><CircleHelp size={18}/><strong>No matching records</strong><span>Change the filters.</span></li>}
    </ul>
    {visible.length > limit && <button type="button" className="jx-more" onClick={() => setLimit((n) => n + PAGE)}>Show {Math.min(PAGE, visible.length - limit)} more · {visible.length - limit} left</button>}
    <p className="jx-gov"><ShieldCheck size={13}/> Automatic checks only recommend. Saving is your decision and is written to the register with the evaluation trace and audit log.</p>
  </div>;
}
