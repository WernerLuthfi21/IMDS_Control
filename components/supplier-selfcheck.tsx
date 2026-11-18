"use client";
import { useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, ClipboardPaste, Download, FileSpreadsheet, FileText, LoaderCircle, Save, Trash2, UploadCloud } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { parseDelimited } from "@/lib/intake/table";
import { detectColumns, FIELD_LABEL, type Detection, type Field } from "@/lib/intake/detect";
import { cellIssues, problemRows } from "@/lib/intake/preview";
import { byPart, readiness, resolution, STATE_LABEL } from "@/lib/intake/resolution";
import type { Analysis, AnalyzedRow, AnswerMap, RowState } from "@/lib/intake/analyze";

type Mapping = Partial<Record<Field, number>>;
type Step = "add" | "preview" | "results";
const MAP_FIELDS: Field[] = ["partNo", "supplierCode", "errorType", "cas", "contentPct", "materialName", "matlClass", "componentPartName", "applicationId", "imdsMass", "drawingMass", "toleranceClass", "partName", "substanceName"];
const PREVIEW_PAGE = 100;
const FILTERS: RowState[] = ["INVALID", "NG", "ASK", "DEPENDS", "HOLD", "OK"];

export function SupplierSelfCheck({ role, supplierCode }: { role: string; supplierCode: string | null }) {
  const isSupplier = role === "supplier";
  const [step, setStep] = useState<Step>("add");
  const [matrix, setMatrix] = useState<string[][]>([]);
  const [fileName, setFileName] = useState("");
  const [mapOverride, setMapOverride] = useState<Mapping | null>(null);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [busy, setBusy] = useState(""); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [onlyProblems, setOnlyProblems] = useState(false); const [limit, setLimit] = useState(PREVIEW_PAGE);
  const [filter, setFilter] = useState<RowState | "ALL">("ALL");
  const [drag, setDrag] = useState(false);
  const [pdf, setPdf] = useState<File | null>(null); const [pdfPart, setPdfPart] = useState("");
  const seq = useRef(0);

  const detected = useMemo(() => (matrix.length ? detectColumns(matrix.slice(0, 60)) : null), [matrix]);
  const det: Detection | null = useMemo(() => {
    if (!detected) return null;
    return mapOverride ? { ...detected, mapping: mapOverride, needsConfirm: false } : detected;
  }, [detected, mapOverride]);
  const issues = useMemo(() => (det ? cellIssues(matrix, det) : new Map()), [matrix, det]);
  const badRows = useMemo(() => problemRows(issues), [issues]);
  const errorCount = useMemo(() => Array.from(issues.values()).filter((i) => i.level === "error").length, [issues]);
  const hasKeys = !!det && det.mapping.partNo !== undefined && (det.mapping.cas !== undefined || det.mapping.imdsMass !== undefined);

  function load(m: string[][], name: string) {
    if (m.length < 2) { setError("The data needs a header row and at least one data row."); return; }
    setMatrix(m); setFileName(name); setMapOverride(null); setAnswers({}); setAnalysis(null); setNotice(""); setError(""); setLimit(PREVIEW_PAGE); setOnlyProblems(false); setFilter("ALL"); setPdf(null); setStep("preview");
  }
  async function onFile(file: File) {
    setError(""); setNotice("");
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (file.size > 20 * 1024 * 1024) { setError("The file is larger than 20 MB."); return; }
    if (ext === "pdf") { setPdf(file); return; }
    if (ext === "csv") { load(parseDelimited(await file.text()), file.name); return; }
    if (ext !== "xlsx") { setError("Use an Excel (.xlsx) or CSV file, paste the cells, or attach a PDF."); return; }
    setBusy("Reading the workbook…");
    try {
      const init = await fetch("/api/prechecks/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: file.name, fileSize: file.size, classification: "PROTECTED" }) });
      const ij = await init.json(); if (!init.ok) throw new Error(ij.error || "Upload could not start.");
      const sb = createClient(); if (!sb) throw new Error("Supabase is not configured.");
      const up = await sb.storage.from("supplier-precheck-private").uploadToSignedUrl(ij.path, ij.token, file); if (up.error) throw new Error(up.error.message);
      const pr = await fetch("/api/self-check/parse-file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storagePath: ij.path, fileName: file.name, classification: "PROTECTED" }) });
      const pj = await pr.json(); if (!pr.ok) throw new Error(pj.error || "The workbook could not be read.");
      setBusy(""); load(pj.matrix, `${file.name} · ${pj.sheetName}`);
      if (pj.truncated) setNotice("The sheet is larger than 5,000 rows or 60 columns; only the first part was loaded.");
    } catch (e) { setBusy(""); setError(e instanceof Error ? e.message : "The file could not be read."); }
  }
  async function attachPdf() {
    if (!pdf || !pdfPart.trim()) return;
    setBusy("Attaching the PDF…"); setError("");
    try {
      const init = await fetch("/api/prechecks/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: pdf.name, fileSize: pdf.size, classification: "PROTECTED" }) });
      const ij = await init.json(); if (!init.ok) throw new Error(ij.error || "Upload could not start.");
      const sb = createClient(); if (!sb) throw new Error("Supabase is not configured.");
      const up = await sb.storage.from("supplier-precheck-private").uploadToSignedUrl(ij.path, ij.token, pdf); if (up.error) throw new Error(up.error.message);
      const r = await fetch("/api/prechecks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ supplierCode: supplierCode || "", deliveryPartNo: pdfPart.trim(), attachmentPath: ij.path, attachmentName: pdf.name, mdsStatus: "Unknown", notes: "Attached from self-check; not read automatically." }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || "Could not attach the PDF.");
      setNotice(`PDF attached to part ${pdfPart.trim()} for Toyota's manual review.`); setPdf(null); setPdfPart("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not attach the PDF."); }
    finally { setBusy(""); }
  }

  const editCell = (r: number, c: number, v: string) => setMatrix((m) => m.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row)));
  const deleteRow = (r: number) => setMatrix((m) => m.filter((_, i) => i !== r));
  const setField = (col: number, field: Field | "") => {
    if (!det) return;
    const next: Mapping = { ...det.mapping };
    for (const k of Object.keys(next) as Field[]) if (next[k] === col) delete next[k];
    if (field) next[field] = col;
    setMapOverride(next);
  };
  const fieldOf = (col: number): Field | "" => (det ? ((Object.keys(det.mapping) as Field[]).find((f) => det.mapping[f] === col) ?? "") : "");

  async function runCheck(ans: AnswerMap = answers) {
    if (!det) return;
    const id = ++seq.current; setBusy("Checking…"); setError("");
    try {
      const r = await fetch("/api/self-check/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ matrix, mapping: det.mapping, headerRow: det.headerRow, answers: ans }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || "The check failed.");
      if (id !== seq.current) return;
      setAnalysis(j.analysis as Analysis); setStep("results");
    } catch (e) { if (id === seq.current) setError(e instanceof Error ? e.message : "The check failed."); }
    finally { if (id === seq.current) setBusy(""); }
  }
  function setAnswer(keys: string[], qid: string, value: string) {
    const next: AnswerMap = { ...answers };
    for (const k of keys) next[k] = { ...(next[k] || {}), [qid]: value };
    setAnswers(next); void runCheck(next);
  }

  const rows = useMemo(() => analysis?.rows ?? [], [analysis]);
  const ready = readiness(rows);
  const parts = useMemo(() => byPart(filter === "ALL" ? rows : rows.filter((r) => r.state === filter)), [rows, filter]);
  const groups = new Map<string, { text: string; options: Array<[string, string]>; keys: string[]; qid: string }>();
  for (const r of rows) if (r.state === "ASK") for (const a of r.ask) { const g = groups.get(a.id + "|" + a.text) ?? { text: a.text, options: a.options, keys: [], qid: a.id }; if (r.key && !g.keys.includes(r.key)) g.keys.push(r.key); groups.set(a.id + "|" + a.text, g); }
  const uniqueSave = Array.from(new Map(rows.filter((r) => r.key && r.partNo && Object.keys(r.answered).length).map((r) => [r.key, r])).values());

  async function save() {
    setBusy("Saving…"); setError(""); setNotice("");
    try {
      const items = uniqueSave.map((r) => ({ partNo: r.partNo, family: r.family, cas: r.cas, flowId: r.flowId, flowTitle: r.flowTitle, errorType: r.errorType, answers: r.answered, resultState: r.state, resultComment: r.comment }));
      const res = await fetch("/api/self-check/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items, fileName }) });
      const j = await res.json(); if (!res.ok) throw new Error(j.error || "Could not save.");
      setNotice(`${j.saved} confirmation(s) saved. Toyota will use them automatically for these part numbers.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save."); }
    finally { setBusy(""); }
  }
  async function downloadRecap() {
    if (!det) return;
    setBusy("Building the recap…"); setError("");
    try {
      const r = await fetch("/api/self-check/recap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ matrix, mapping: det.mapping, headerRow: det.headerRow, answers, fileName }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || "Could not build the recap."); }
      const url = URL.createObjectURL(await r.blob()); const a = document.createElement("a"); a.href = url; a.download = "self-check-recap.xlsx"; a.click(); URL.revokeObjectURL(url);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not build the recap."); }
    finally { setBusy(""); }
  }

  const header = det?.headerRow !== null && det?.headerRow !== undefined ? det.headerRow : null;
  const cols = matrix[0]?.length ?? 0;
  const dataIdx = useMemo(() => { if (!det) return []; const out: number[] = []; for (let r = det.dataStart; r < matrix.length; r++) if (matrix[r].some((c) => c.trim()) && (!onlyProblems || badRows.has(r))) out.push(r); return out; }, [det, matrix, onlyProblems, badRows]);
  const stepNo = step === "add" ? 1 : step === "preview" ? 2 : 3;

  return <section className="sc-wrap">
    <div className="sc-head"><div><span className="sc-kicker"><FileSpreadsheet size={13}/> SELF-CHECK BEFORE TOYOTA REVIEWS</span><h2>Check your data</h2></div>
      <ol className="sc-steps" aria-label="Steps">{["Add data", "Preview & fix", "Results"].map((t, i) => <li key={t} className={i + 1 === stepNo ? "on" : i + 1 < stepNo ? "done" : ""}><span>{i + 1 < stepNo ? "✓" : i + 1}</span>{t}</li>)}</ol></div>
    {busy && <div className="sc-busy" role="status"><LoaderCircle size={14} className="spin"/> {busy}</div>}
    {error && <div className="callout callout-danger" role="alert"><AlertTriangle size={14}/>{error}</div>}
    {notice && <div className="callout callout-success"><CheckCircle2 size={14}/>{notice}</div>}

    {step === "add" && <>
      <div className={"sc-drop" + (drag ? " on" : "")} data-dropzone="" onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setDrag(true); }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrag(false); }} onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) void onFile(f); }}>
        <label className="sc-file"><UploadCloud size={22}/><strong>Drop a file here or click</strong><span>.xlsx · .csv · .pdf</span>
          <input type="file" hidden accept=".xlsx,.csv,.pdf" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }}/></label>
        <div className="sc-or">or</div>
        <label className="sc-paste"><span><ClipboardPaste size={14}/> Paste cells from Excel</span>
          <textarea rows={4} placeholder="Click here, then Ctrl+V" onPaste={(e) => { const t = e.clipboardData.getData("text"); if (t.trim()) { e.preventDefault(); load(parseDelimited(t), "Pasted cells"); (e.target as HTMLTextAreaElement).value = ""; } }} aria-label="Paste table data"/></label>
      </div>
      {pdf && <div className="sc-pdf"><FileText size={16}/><div><strong>{pdf.name}</strong><span>PDFs are attached for Toyota to read; they are not read automatically. Part number:</span></div>
        <input className="field" value={pdfPart} onChange={(e) => setPdfPart(e.target.value)} placeholder="Delivery Part No." aria-label="Part number for the PDF"/><button className="btn btn-primary btn-sm" type="button" disabled={!pdfPart.trim() || !isSupplier || !!busy} onClick={() => void attachPdf()}>Attach PDF</button></div>}
    </>}

    {step === "preview" && det && <>
      <div className="sc-meta"><span><strong>{fileName}</strong> · {dataIdx.length === 0 && onlyProblems ? 0 : Math.max(0, matrix.length - det.dataStart)} row(s)</span>
        <span className={errorCount ? "sc-flag err" : issues.size ? "sc-flag warn" : "sc-flag ok"}>{errorCount ? `${errorCount} to fix` : issues.size ? `${issues.size} to review` : "No problems found"}</span></div>
      {!hasKeys && <div className="callout callout-info"><AlertTriangle size={14}/><span>Choose which column is the <strong>Part No.</strong> and which is the <strong>CAS</strong> (or IMDS mass) using the drop-downs above the columns.</span></div>}
      {det.warnings.map((w) => <div key={w} className="callout callout-info"><AlertTriangle size={14}/><span>{w}</span></div>)}
      <label className="sc-only"><input type="checkbox" checked={onlyProblems} onChange={(e) => { setOnlyProblems(e.target.checked); setLimit(PREVIEW_PAGE); }}/> Show only rows with problems</label>
      <div className="table-scroll sc-gridwrap"><table className="sc-grid"><thead>
        <tr><th></th>{Array.from({ length: cols }, (_, c) => <th key={c}><select aria-label={`Meaning of column ${c + 1}`} value={fieldOf(c)} onChange={(e) => setField(c, e.target.value as Field | "")} className={fieldOf(c) ? "mapped" : ""}><option value="">— ignore —</option>{MAP_FIELDS.map((f) => <option key={f} value={f}>{FIELD_LABEL[f]}</option>)}</select></th>)}</tr>
        {header !== null && <tr className="sc-hdr"><th></th>{matrix[header].map((h, c) => <th key={c}>{h || `Column ${c + 1}`}</th>)}</tr>}</thead>
        <tbody>{dataIdx.slice(0, limit).map((r) => <tr key={r} className={badRows.has(r) ? "bad" : ""}>
          <td className="sc-rn"><span>{r + 1}</span><button type="button" aria-label={`Delete row ${r + 1}`} onClick={() => deleteRow(r)}><Trash2 size={12}/></button></td>
          {matrix[r].map((v, c) => { const i = issues.get(`${r},${c}`); return <td key={c} className={i ? "sc-cell " + i.level : "sc-cell"} title={i?.text}><input value={v} aria-label={`Row ${r + 1} column ${c + 1}`} onChange={(e) => editCell(r, c, e.target.value)}/>{i && <em>{i.text}</em>}</td>; })}</tr>)}</tbody></table></div>
      {dataIdx.length > limit && <div className="sc-more"><button type="button" className="btn btn-sm" onClick={() => setLimit(limit + PREVIEW_PAGE * 3)}>Show more ({dataIdx.length - limit} left)</button></div>}
      <div className="sc-save"><button type="button" className="btn" onClick={() => setStep("add")}><ArrowLeft size={14}/> Different data</button>
        <button type="button" className="btn btn-primary" disabled={!hasKeys || !!busy} onClick={() => void runCheck()}>Check {Math.max(0, matrix.length - det.dataStart)} row(s) <ArrowRight size={14}/></button></div>
    </>}

    {step === "results" && analysis && <>
      <div className={"sc-ready " + (ready.ready ? "ok" : "wait")}>{ready.ready ? <CheckCircle2 size={16}/> : <AlertTriangle size={16}/>}
        <div><strong>{ready.ready ? (ready.ng ? `Nothing is waiting on you; ${ready.ng} item(s) are likely NG` : "Nothing is waiting on you") : `${ready.waiting} item(s) need your action`}</strong>
          <span>{ready.ready ? "Save your confirmations, then correct any NG items in IMDS before you submit." : "Answer the questions or fix the data. Your answers are remembered per part number."}</span></div></div>
      <div className="sc-counts">{FILTERS.filter((s) => analysis.counts[s]).map((s) => <button key={s} type="button" className={`sc-chip ${s.toLowerCase()}${filter === s ? " on" : ""}`} onClick={() => setFilter(filter === s ? "ALL" : s)}>{STATE_LABEL[s]} <b>{analysis.counts[s]}</b></button>)}</div>
      {groups.size > 0 && <div className="sc-bulk"><strong>Answer once for every item that asks the same thing</strong>
        {Array.from(groups.values()).map((g) => <div key={g.qid + g.text} className="sc-q"><span>{g.text} <em>({g.keys.length} item{g.keys.length > 1 ? "s" : ""})</em></span><div className="sc-opts">{g.options.map(([v, t]) => <button key={v} type="button" onClick={() => setAnswer(g.keys, g.qid, v)}>{t}</button>)}</div></div>)}</div>}
      <div className="sc-parts">{parts.slice(0, 200).map((p) => <details key={p.partNo} className={"sc-part " + p.worst.toLowerCase()} open={p.worst !== "OK" && p.worst !== "HOLD"}>
        <summary><strong>{p.partNo}</strong><span className={`sc-chip ${p.worst.toLowerCase()} static`}>{STATE_LABEL[p.worst]}</span><small>{p.items.length} item(s)</small></summary>
        <ul>{p.items.map((r: AnalyzedRow, i) => <li key={r.r + "-" + r.cas + "-" + i}>
          <div className="sc-itemhead"><span className="mono">{r.cas || (r.family === "pb" ? "Pb" : r.family === "mass" ? "Mass" : r.flowTitle || "—")}</span><span className={`sc-chip ${r.state.toLowerCase()} static`}>{STATE_LABEL[r.state]}</span></div>
          <p>{resolution(r)}</p>
          {r.state === "DEPENDS" && r.byDest && <p className="sc-dest">{Object.entries(r.byDest).map(([d, s]) => `${d} ${s}`).join(" · ")}</p>}
          {r.state === "ASK" && r.ask.map((a) => <div key={a.id} className="sc-q"><span>{a.text}</span><div className="sc-opts">{a.options.map(([v, t]) => <button key={v} type="button" className={r.answered[a.id] === v ? "on" : ""} onClick={() => setAnswer([r.key], a.id, v)}>{t}</button>)}</div></div>)}
          {Object.keys(r.answered).length > 0 && r.state !== "ASK" && <span className="sc-ans">Your answer: {Object.values(r.answered).join(", ")}</span>}</li>)}</ul></details>)}
        {parts.length > 200 && <div className="sc-more">Showing the first 200 part numbers. Use the recap file for the full list.</div>}</div>
      <div className="sc-save"><button type="button" className="btn" onClick={() => setStep("preview")}><ArrowLeft size={14}/> Edit data</button>
        <span className="sc-spacer"/>
        <button type="button" className="btn" disabled={!!busy} onClick={() => void downloadRecap()}><Download size={14}/> Recap (XLSX)</button>
        <button type="button" className="btn btn-primary" disabled={!isSupplier || !uniqueSave.length || !!busy} title={isSupplier ? "" : "Only supplier accounts can save confirmations"} onClick={() => void save()}><Save size={14}/> Save my confirmations ({uniqueSave.length})</button></div>
      <small className="sc-fine">Preliminary self-check only. It is not a G-CATS approval and not an IMDS upload file. Toyota makes the final OK/NG.</small>
    </>}
  </section>;
}
