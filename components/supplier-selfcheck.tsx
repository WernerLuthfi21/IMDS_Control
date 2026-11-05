"use client";
import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardPaste, Download, FileSpreadsheet, FileText, LoaderCircle, Save, SlidersHorizontal, UploadCloud } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { parseDelimited } from "@/lib/intake/table";
import { FIELD_LABEL, type Field } from "@/lib/intake/detect";
import type { Analysis, AnalyzedRow, AnswerMap, RowState } from "@/lib/intake/analyze";

type Mapping = Partial<Record<Field, number>>;
const STATE_LABEL: Record<RowState, string> = { OK: "OK", NG: "NG", ASK: "Answer needed", DEPENDS: "Depends on destination", HOLD: "Toyota reviews", INVALID: "Fix data" };
const FILTERS: RowState[] = ["ASK", "NG", "OK", "DEPENDS", "HOLD", "INVALID"];
const MAP_FIELDS: Field[] = ["partNo", "supplierCode", "errorType", "cas", "contentPct", "materialName", "matlClass", "componentPartName", "applicationId", "imdsMass", "drawingMass", "toleranceClass", "partName", "substanceName"];
const PAGE = 150;

export function SupplierSelfCheck({ role, supplierCode }: { role: string; supplierCode: string | null }) {
  const isSupplier = role === "supplier";
  const [matrix, setMatrix] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState("");
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [headerRow, setHeaderRow] = useState<number | null | undefined>(undefined);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState<RowState | "ALL">("ALL");
  const [limit, setLimit] = useState(PAGE);
  const [showMap, setShowMap] = useState(false);
  const [drag, setDrag] = useState(false);
  const [pdf, setPdf] = useState<File | null>(null);
  const [pdfPart, setPdfPart] = useState("");
  const seq = useRef(0);

  async function analyze(m: string[][], map: Mapping | null, hr: number | null | undefined, ans: AnswerMap) {
    const id = ++seq.current; setBusy("Checking…"); setError("");
    try {
      const r = await fetch("/api/self-check/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ matrix: m, mapping: map || undefined, headerRow: hr, answers: ans }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || "The check failed.");
      if (id !== seq.current) return;
      setAnalysis(j.analysis as Analysis);
      if (j.analysis.detection.needsConfirm && !map) setShowMap(true);
    } catch (e) { if (id === seq.current) setError(e instanceof Error ? e.message : "The check failed."); }
    finally { if (id === seq.current) setBusy(""); }
  }
  function load(m: string[][], name: string) {
    if (m.length < 2) { setError("The data needs a header row and at least one data row."); return; }
    setMatrix(m); setFileName(name); setMapping(null); setHeaderRow(undefined); setAnswers({}); setNotice(""); setFilter("ALL"); setLimit(PAGE); setShowMap(false); setPdf(null);
    void analyze(m, null, undefined, {});
  }
  function onPaste(text: string) { if (text.trim()) load(parseDelimited(text), "Pasted cells"); }

  async function onFile(file: File) {
    setError(""); setNotice("");
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (file.size > 20 * 1024 * 1024) { setError("The file is larger than 20 MB."); return; }
    if (ext === "pdf") { setPdf(file); setMatrix(null); setAnalysis(null); return; }
    if (ext === "csv") { load(parseDelimited(await file.text()), file.name); return; }
    if (ext !== "xlsx") { setError("Use an Excel (.xlsx), CSV or PDF file, or paste the cells."); return; }
    setBusy("Reading the workbook…");
    try {
      const init = await fetch("/api/prechecks/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: file.name, fileSize: file.size, classification: "PROTECTED" }) });
      const ij = await init.json(); if (!init.ok) throw new Error(ij.error || "Upload could not start.");
      const sb = createClient(); if (!sb) throw new Error("Supabase is not configured.");
      const up = await sb.storage.from("supplier-precheck-private").uploadToSignedUrl(ij.path, ij.token, file); if (up.error) throw new Error(up.error.message);
      const pr = await fetch("/api/self-check/parse-file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storagePath: ij.path, fileName: file.name, classification: "PROTECTED" }) });
      const pj = await pr.json(); if (!pr.ok) throw new Error(pj.error || "The workbook could not be read.");
      if (pj.truncated) setNotice("The sheet is larger than 5,000 rows or 60 columns; only the first part was checked.");
      setBusy(""); load(pj.matrix, `${file.name} · ${pj.sheetName}`);
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

  function changeMapping(field: Field, col: number | "") {
    if (!matrix || !analysis) return;
    const next: Mapping = { ...(mapping || analysis.detection.mapping) };
    if (col === "") delete next[field]; else next[field] = col;
    setMapping(next); void analyze(matrix, next, headerRow === undefined ? analysis.detection.headerRow : headerRow, answers);
  }
  function setAnswer(keys: string[], qid: string, value: string) {
    if (!matrix) return;
    const next: AnswerMap = { ...answers };
    for (const k of keys) next[k] = { ...(next[k] || {}), [qid]: value };
    setAnswers(next); void analyze(matrix, mapping, headerRow, next);
  }

  const rows = analysis?.rows ?? [];
  const shown = (filter === "ALL" ? rows : rows.filter((r) => r.state === filter));
  // one question asked by many rows → answer once for all of them
  const groups = new Map<string, { text: string; options: Array<[string, string]>; keys: string[]; qid: string }>();
  for (const r of rows) if (r.state === "ASK") for (const a of r.ask) { const g = groups.get(a.id + "|" + a.text) ?? { text: a.text, options: a.options, keys: [], qid: a.id }; if (r.key && !g.keys.includes(r.key)) g.keys.push(r.key); groups.set(a.id + "|" + a.text, g); }
  const toSave = rows.filter((r) => r.key && r.partNo && Object.keys(r.answered).length);
  const uniqueSave = Array.from(new Map(toSave.map((r) => [r.key, r])).values());

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
  function download() {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const head = ["Row", "Part No.", "CAS", "Flow", "Result", "Comment", "Reason", "By destination"];
    const lines = rows.map((r) => [String(r.r), r.partNo, r.cas, r.flowTitle, STATE_LABEL[r.state], r.comment, r.reason, r.byDest ? Object.entries(r.byDest).map(([d, s]) => `${d}:${s}`).join(" ") : ""].map(esc).join(","));
    const url = URL.createObjectURL(new Blob(["﻿" + [head.map(esc).join(","), ...lines].join("\n")], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = "self-check-results.csv"; a.click(); URL.revokeObjectURL(url);
  }

  const det = analysis?.detection;
  const cols = det ? matrix?.[0]?.length ?? 0 : 0;
  const headerLabels = (i: number) => (det?.headerRow !== null && det?.headerRow !== undefined ? matrix?.[det.headerRow]?.[i] : "") || `Column ${i + 1}`;
  return <section className="sc-wrap">
    <div className="sc-head"><div><span className="sc-kicker"><FileSpreadsheet size={13}/> SELF-CHECK BEFORE TOYOTA REVIEWS</span><h2>Check your data</h2>
      <p>Drop an Excel / CSV file, or copy the cells from Excel and paste them here. The columns are recognised automatically — a Part No. plus a CAS (or mass) column is enough.</p></div></div>
    <div className={"sc-drop" + (drag ? " on" : "")} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) void onFile(f); }}>
      <label className="sc-file"><UploadCloud size={22}/><strong>Drag a file here or click</strong><span>.xlsx · .csv · .pdf (PDF is attached for Toyota, not read automatically)</span>
        <input type="file" hidden accept=".xlsx,.csv,.pdf" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }}/></label>
      <div className="sc-or">or</div>
      <label className="sc-paste"><span><ClipboardPaste size={14}/> Paste cells from Excel (include the header row)</span>
        <textarea rows={4} placeholder="Click here, then Ctrl+V" onPaste={(e) => { const t = e.clipboardData.getData("text"); if (t) { e.preventDefault(); onPaste(t); (e.target as HTMLTextAreaElement).value = ""; } }} aria-label="Paste table data"/></label>
    </div>
    {pdf && <div className="sc-pdf"><FileText size={16}/><div><strong>{pdf.name}</strong><span>Toyota&apos;s MDS Report PDFs state that parsing is not allowed, so PDFs are attached to a part number and reviewed by a person. Enter the part number:</span></div>
      <input className="field" value={pdfPart} onChange={(e) => setPdfPart(e.target.value)} placeholder="Delivery Part No." aria-label="Part number for the PDF"/><button className="btn btn-primary btn-sm" type="button" disabled={!pdfPart.trim() || !isSupplier || !!busy} onClick={() => void attachPdf()}>Attach PDF</button></div>}
    {busy && <div className="sc-busy"><LoaderCircle size={14} className="spin"/> {busy}</div>}
    {error && <div className="callout callout-danger" role="alert"><AlertTriangle size={14}/>{error}</div>}
    {notice && <div className="callout callout-success"><CheckCircle2 size={14}/>{notice}</div>}
    {det && matrix && <>
      <div className="sc-meta"><span><strong>{fileName}</strong> · {rows.length} item(s) checked{analysis!.truncated ? " (first 5,000)" : ""}</span>
        <button type="button" className="btn btn-sm" onClick={() => setShowMap((v) => !v)}><SlidersHorizontal size={13}/> Columns {det.needsConfirm ? "· please confirm" : "· detected"}</button></div>
      {det.warnings.length > 0 && <div className="callout callout-info"><AlertTriangle size={14}/><span>{det.warnings.join(" ")}</span></div>}
      {showMap && <div className="sc-map">{MAP_FIELDS.map((f) => { const cur = (mapping || det.mapping)[f]; const g = cur !== undefined ? det.columns[cur] : null; return <label key={f}><span>{FIELD_LABEL[f]}{g && !mapping ? <em className={g.confidence >= 0.9 ? "hi" : "lo"}> {Math.round(g.confidence * 100)}%</em> : null}</span>
        <select className="select-field" value={cur ?? ""} onChange={(e) => changeMapping(f, e.target.value === "" ? "" : Number(e.target.value))}><option value="">— not in file —</option>{Array.from({ length: cols }, (_, i) => <option key={i} value={i}>{headerLabels(i)}</option>)}</select></label>; })}</div>}
      <div className="sc-counts">{FILTERS.filter((s) => analysis!.counts[s]).map((s) => <button key={s} type="button" className={`sc-chip ${s.toLowerCase()}${filter === s ? " on" : ""}`} onClick={() => { setFilter(filter === s ? "ALL" : s); setLimit(PAGE); }}>{STATE_LABEL[s]} <b>{analysis!.counts[s]}</b></button>)}
        <span className="sc-spacer"/><button type="button" className="btn btn-sm" onClick={download}><Download size={13}/> Results (CSV)</button></div>
      {groups.size > 0 && <div className="sc-bulk"><strong>Answer once for every item that asks the same thing</strong>
        {Array.from(groups.values()).map((g) => <div key={g.qid + g.text} className="sc-q"><span>{g.text} <em>({g.keys.length} item{g.keys.length > 1 ? "s" : ""})</em></span><div className="sc-opts">{g.options.map(([v, t]) => <button key={v} type="button" onClick={() => setAnswer(g.keys, g.qid, v)}>{t}</button>)}</div></div>)}</div>}
      <div className="table-scroll"><table className="sc-table"><thead><tr><th>Row</th><th>Part No.</th><th>CAS / item</th><th>Result</th><th>What it means</th></tr></thead>
        <tbody>{shown.slice(0, limit).map((r, i) => <Row key={r.r + "-" + r.cas + "-" + i} r={r} onAnswer={(q, v) => setAnswer([r.key], q, v)}/>)}</tbody></table></div>
      {shown.length > limit && <div className="sc-more"><button type="button" className="btn btn-sm" onClick={() => setLimit(limit + PAGE * 4)}>Show more ({shown.length - limit} left)</button></div>}
      <div className="sc-save"><small>Preliminary self-check only — not a G-CATS approval. Toyota makes the final OK/NG.</small>
        <button type="button" className="btn btn-primary" disabled={!isSupplier || !uniqueSave.length || !!busy} title={isSupplier ? "" : "Only supplier accounts can save confirmations"} onClick={() => void save()}><Save size={14}/> Save my confirmations ({uniqueSave.length})</button></div>
    </>}
  </section>;
}

function Row({ r, onAnswer }: { r: AnalyzedRow; onAnswer: (q: string, v: string) => void }) {
  const dest = r.byDest && Object.keys(r.byDest).length > 2 || r.state === "DEPENDS" ? Object.entries(r.byDest || {}).map(([d, s]) => `${d} ${s}`).join(" · ") : "";
  return <tr><td className="mono">{r.r}</td><td className="cell-strong">{r.partNo || "—"}</td><td className="mono">{r.cas || (r.family === "pb" ? "Pb" : r.family === "mass" ? "Mass" : "—")}</td>
    <td><span className={`sc-chip ${r.state.toLowerCase()} static`}>{STATE_LABEL[r.state]}</span></td>
    <td className="sc-what"><strong>{r.flowTitle}</strong>{r.comment && <span>Comment: “{r.comment}”</span>}{r.state !== "OK" && r.state !== "NG" && <span>{r.issues[0] || r.reason}</span>}{dest && <span className="sc-dest">{dest}</span>}
      {r.state === "ASK" && r.ask.map((a) => <div key={a.id} className="sc-q"><span>{a.text}</span><div className="sc-opts">{a.options.map(([v, t]) => <button key={v} type="button" className={r.answered[a.id] === v ? "on" : ""} onClick={() => onAnswer(a.id, v)}>{t}</button>)}</div></div>)}
      {Object.keys(r.answered).length > 0 && r.state !== "ASK" && <span className="sc-ans">Your answer: {Object.values(r.answered).join(", ")}</span>}</td></tr>;
}
