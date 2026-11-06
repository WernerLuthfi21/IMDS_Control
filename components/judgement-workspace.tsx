"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, Check, ChevronDown, CircleCheck, CircleDashed, CircleHelp, CircleX, Clock3, LoaderCircle, Mail, Search, ShieldCheck, UserRound } from "lucide-react";
import type { AutoOutput, StepStatus } from "@/lib/judgement/auto";
import { createClient } from "@/lib/supabase/client";

type Item = {
  id: string; source_record_key: string; error_type_label: string; delivery_part_no: string | null; supplier_code: string | null;
  source_status: string | null; source_year: string | null; source_month: string | null; judge: string | null; km_judge: string | null;
  source_km_judge_label: string | null; assigned_person: string | null; starting_date: string | null; judgement_procedure: string | null;
  ok_comment: string | null; imds_reject_comment: string | null; case_id: string | null; cas: string; substance_name: string;
};
type Tab = "pending" | "judged" | "km";
const PAGE = 80;
const DESTINATIONS: Array<[string, string]> = [["EU", "EU · Europe, Israel, Turkey"], ["KR", "Korea"], ["CN", "China"], ["TW", "Taiwan"], ["IN", "India"], ["JP", "Japan"], ["OTH", "Other"]];
const CLASSES = ["MA", "MB", "MC", "MD", "ME", "MF"];
const monthNames: Record<string, string> = { "1": "Jan", "01": "Jan", "2": "Feb", "02": "Feb", "3": "Mar", "03": "Mar", "4": "Apr", "04": "Apr", "5": "May", "05": "May", "6": "Jun", "06": "Jun", "7": "Jul", "07": "Jul", "8": "Aug", "08": "Aug", "9": "Sep", "09": "Sep", "10": "Oct", "11": "Nov", "12": "Dec" };
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());

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
  const canEdit = ["admin", "preparer", "reviewer"].includes(role);

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
      if (errorType !== "All Error Types" && r.error_type_label !== errorType) return false;
      if (month !== "All" && String(r.source_month || "") !== month) return false;
      return !q || [r.source_record_key, r.delivery_part_no, r.supplier_code, r.error_type_label, r.cas, r.substance_name].some((v) => String(v || "").toLowerCase().includes(q));
    });
  }, [rows, tab, errorType, month, search]);
  const filterKey = [tab, errorType, month, search].join("|");
  const [prevKey, setPrevKey] = useState(filterKey);
  if (prevKey !== filterKey) { setPrevKey(filterKey); setLimit(PAGE); setOpenId(null); }

  const onSaved = useCallback((id: string, patch: Partial<Item>) => { setRows((old) => old.map((r) => r.id === id ? { ...r, ...patch } : r)); setOpenId(null); }, []);
  const updated = sourceDate ? new Date(sourceDate).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : null;

  return <div className="jx">
    <header className="jx-head">
      <div><h1>Judgement</h1><p>{year} · WORKING records{updated ? " · snapshot " + updated : ""} · <span title="Other users' judgements appear here as they are saved">{live ? "● live" : "○ not live"}</span></p></div>
      <a className="jx-back" href="/workspace"><ArrowLeft size={14}/> Menu</a>
    </header>
    {queryError && <div className="jx-error"><AlertTriangle size={14}/> {queryError}</div>}
    {rows.length === 0 && !queryError && <div className="jx-empty"><strong>No current-year source records</strong><span>Commit the current G-CATS workbook from Daily G-CATS Update to fill the queue.</span></div>}

    <nav className="jx-tabs" aria-label="Queue">
      {([["pending", "To judge", counts.pending], ["judged", "Judged", counts.judged], ["km", "Awaiting KM", counts.km]] as const).map(([k, label, n]) =>
        <button type="button" key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{label}<b>{n.toLocaleString("en-US")}</b></button>)}
    </nav>

    <div className="jx-filters">
      <label className="jx-search"><Search size={14}/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Part no., supplier, CAS, substance…" aria-label="Search"/></label>
      <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month"><option value="All">All months</option>{months.map((m) => <option key={m} value={m}>{monthNames[m] || m}</option>)}</select>
    </div>
    <div className="jx-types" role="group" aria-label="Error type">
      <button type="button" className={errorType === "All Error Types" ? "on" : ""} onClick={() => setErrorType("All Error Types")}>All</button>
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
