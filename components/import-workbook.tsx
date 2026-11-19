"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DropZone } from "@/components/drop-zone";
import { friendlyImportError } from "@/lib/import-errors";
import { AlertTriangle, CheckCircle2, ChevronRight, CloudUpload, FileSpreadsheet, FolderSync, LoaderCircle, RefreshCw, Send, Sheet, XCircle } from "lucide-react";

type Preview = {
  batchId: string; fileName: string; sheetName: string; headerRow: number; rowCount: number; errorRows: number; caseCount: number;
  newRecords: number; refreshedRecords: number; sameSnapshotRows: number; judgementFieldsDetected: number;
  typeCounts: Record<string, number>; warnings: string[]; sampleRows: Record<string, unknown>[];
};
type Batch = { id: string; file_name: string; source_sheet: string; total_rows: number; committed_rows: number; status: string; created_at: string; committed_at: string | null };
type Sync = { configured?: { excel: boolean; secret: boolean }; counts?: Record<string, number>; lastError?: string | null; failed?: { error: string | null }[] };
type Done = { rows: number; queued: number; flowConfigured: boolean; error: string | null; file: string };
type FileHandleLike = { getFile: () => Promise<File>; queryPermission?: (o: { mode: "read" }) => Promise<PermissionState>; requestPermission?: (o: { mode: "read" }) => Promise<PermissionState> };
type PickerWindow = Window & { showOpenFilePicker?: (options: unknown) => Promise<FileHandleLike[]> };

const ALLOWED = ["PROTECTED", "INTERNAL", "PUBLIC"];
/** Small files go straight to the preview route (no Storage step). Matches DIRECT_UPLOAD_BYTES on the server. */
const DIRECT_MAX = 3.5 * 1024 * 1024;
const fmt = (n: number) => n.toLocaleString();
function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now"; if (s < 3600) return `${Math.round(s / 60)} min ago`; if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

export function ImportWorkbook() {
  const [file, setFile] = useState<File | null>(null);
  const [classification, setClassification] = useState("PROTECTED");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState("");
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Done | null>(null);
  const [history, setHistory] = useState<Batch[]>([]);
  const [sync, setSync] = useState<Sync | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [fileSource, setFileSource] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [intervalSec, setIntervalSec] = useState("30");
  const [sourceStatus, setSourceStatus] = useState("");
  const [spStatus, setSpStatus] = useState("");
  const [spBusy, setSpBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const handleRef = useRef<FileHandleLike | null>(null);
  const lastVersionRef = useRef("");
  const allowed = ALLOWED.includes(classification);
  const step = done ? 4 : preview ? (committing ? 3 : 2) : 1;

  const loadHistory = useCallback(async () => { try { const r = await fetch("/api/imports/history", { cache: "no-store" }); const j = await r.json(); if (r.ok) setHistory(j.batches || []); } catch { /* history is optional */ } }, []);
  const loadSync = useCallback(async () => { try { const r = await fetch("/api/automation/status", { cache: "no-store" }); if (r.ok) setSync(await r.json()); } catch { /* status is optional */ } }, []);
  useEffect(() => { const t = window.setTimeout(() => { void loadHistory(); void loadSync(); }, 0); return () => window.clearTimeout(t); }, [loadHistory, loadSync]);

  async function inspectFile(f: File) {
    setError(""); setDone(null); setPreview(null);
    if (!ALLOWED.includes(classification)) { setError("CONFIDENTIAL and UNKNOWN files are not processed. Choose the right classification first."); return; }
    try {
      let r: Response;
      if (f.size <= DIRECT_MAX) {
        setBusy("Reading the workbook…");
        const form = new FormData(); form.append("file", f, f.name); form.append("classification", classification);
        r = await fetch("/api/imports/preview", { method: "POST", body: form });
      } else {
        setBusy("Uploading to secure storage…");
        const supabase = createClient(); if (!supabase) throw new Error("Persistent import requires Supabase. Sign in first.");
        const init = await fetch("/api/imports/create-upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: f.name, fileSize: f.size, classification }) });
        const initJson = await init.json(); if (!init.ok) throw new Error(initJson.error || "Could not start the upload");
        const upload = await supabase.storage.from("import-staging").uploadToSignedUrl(initJson.path, initJson.token, f);
        if (upload.error) throw new Error(upload.error.message);
        setBusy("Reading the workbook…");
        r = await fetch("/api/imports/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storagePath: initJson.path, fileName: f.name, classification }) });
      }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Preview failed (HTTP ${r.status})`);
      setPreview(j.preview); void loadHistory();
    } catch (e) { setError(friendlyImportError(e)); } finally { setBusy(""); }
  }
  function takeFile(f: File | null, source = "") {
    setFile(f); setPreview(null); setError(""); setDone(null); setFileSource(source);
    if (f) void inspectFile(f);
  }
  async function commit() {
    if (!preview) return;
    setCommitting(true); setError("");
    try {
      const r = await fetch("/api/imports/commit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId: preview.batchId }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Commit failed");
      setDone({ rows: j.itemsCreated ?? 0, queued: j.register?.queued ?? 0, flowConfigured: !!j.register?.flowConfigured, error: j.register?.error ?? null, file: preview.fileName });
      setPreview(null); setFile(null); void loadHistory(); window.setTimeout(() => void loadSync(), 4000);
    } catch (e) { setError(friendlyImportError(e)); } finally { setCommitting(false); }
  }
  async function sendWaiting(retryFailed: boolean) {
    setSyncBusy(true); setSyncMsg("");
    try {
      const r = await fetch("/api/automation/dispatch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ retryFailed }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Could not send");
      setSyncMsg(`Sent ${j.sent ?? 0} · failed ${j.failed ?? 0}${j.skipped ? ` · ${j.skipped} waiting for the flow to be set up` : ""}.`);
    } catch (e) { setSyncMsg(friendlyImportError(e)); } finally { setSyncBusy(false); void loadSync(); }
  }

  async function connectFile() {
    setError("");
    const picker = (window as PickerWindow).showOpenFilePicker;
    if (!picker) { setError("This browser cannot keep a file connected. Use Chrome or Edge, or just drop the file."); return; }
    try {
      const [handle] = await picker({ multiple: false, types: [{ description: "Excel workbook", accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] } }] });
      if (!handle) return;
      handleRef.current = handle; setConnected(true);
      const f = await handle.getFile(); lastVersionRef.current = `${f.lastModified}:${f.size}`;
      setSourceStatus(`Connected on this computer: ${f.name}`);
      takeFile(f, "Connected file on this computer");
    } catch (e) { if (!(e instanceof DOMException && e.name === "AbortError")) setError(friendlyImportError(e)); }
  }
  const refreshFile = useCallback(async (silent = false) => {
    const handle = handleRef.current; if (!handle) return;
    try {
      if (handle.queryPermission) {
        let p = await handle.queryPermission({ mode: "read" });
        if (p !== "granted" && handle.requestPermission) p = await handle.requestPermission({ mode: "read" });
        if (p !== "granted") { setSourceStatus("Allow reading the file to check for a new version."); return; }
      }
      const f = await handle.getFile(), v = `${f.lastModified}:${f.size}`;
      if (v !== lastVersionRef.current) { lastVersionRef.current = v; setSourceStatus(`New version found · ${new Date(f.lastModified).toLocaleString()}`); takeFile(f, "Connected file on this computer"); }
      else if (!silent) setSourceStatus(`No change since ${new Date(f.lastModified).toLocaleString()}`);
    } catch (e) { setSourceStatus(friendlyImportError(e)); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classification]);
  useEffect(() => {
    if (!autoRefresh || !handleRef.current) return;
    const t = window.setInterval(() => { void refreshFile(true); }, Number(intervalSec) * 1000);
    return () => window.clearInterval(t);
  }, [autoRefresh, intervalSec, refreshFile]);
  async function checkSharePoint() {
    setSpBusy(true); setSpStatus("");
    try {
      const r = await fetch("/api/sharepoint/status", { cache: "no-store" }); const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Status failed");
      setSpStatus(!j.configured ? "Not set up on the server (Microsoft Graph app registration needed). Drop the file instead; it works the same." : !j.reachable ? `Set up, but SharePoint did not answer: ${j.error || ""}` : `Connected: ${j.file.name} · changed ${new Date(j.file.lastModified).toLocaleString()}`);
    } catch (e) { setSpStatus(friendlyImportError(e)); } finally { setSpBusy(false); }
  }
  async function fetchSharePoint() {
    setSpBusy(true); setError(""); setPreview(null); setDone(null);
    try {
      const st = await fetch("/api/sharepoint/stage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ classification }) });
      const sj = await st.json(); if (!st.ok) throw new Error(sj.error || "SharePoint fetch failed");
      const r = await fetch("/api/imports/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storagePath: sj.storagePath, fileName: sj.fileName, classification }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || "Preview failed");
      setPreview(j.preview); setFileSource("SharePoint");
    } catch (e) { setError(friendlyImportError(e)); } finally { setSpBusy(false); }
  }

  const waiting = sync?.counts ? Object.entries(sync.counts).filter(([k]) => k.startsWith("EXCEL_UPSERT:") && !k.endsWith(":FAILED")).reduce((n, [, v]) => n + v, 0) : 0;
  const failed = sync?.counts?.["EXCEL_UPSERT:FAILED"] || 0;
  const flowOn = !!sync?.configured?.excel;
  const types = preview ? Object.entries(preview.typeCounts).sort((a, b) => b[1] - a[1]) : [];
  const maxType = types.length ? types[0][1] : 1;

  return <div className="gx">
    <ol className="gx-steps" aria-label="Daily update steps">
      {["Drop the export", "Check the preview", "Commit", "Register synced"].map((t, i) => <li key={t} className={step > i + 1 ? "done" : step === i + 1 ? "now" : ""} aria-current={step === i + 1 ? "step" : undefined}><span>{step > i + 1 ? <CheckCircle2 size={14} /> : i + 1}</span>{t}</li>)}
    </ol>

    <div className="gx-top">
      <section className="gx-card gx-drop" aria-labelledby="gx-drop-h">
        <div className="gx-head"><div><h2 id="gx-drop-h">Today’s G-CATS Error Check Log</h2><p>Drop the daily .xlsx export. The preview starts by itself; nothing changes until you commit.</p></div>
          <label className="gx-class"><span>Classification</span><select value={classification} onChange={(e) => setClassification(e.target.value)} aria-label="Document classification"><option value="PROTECTED">PROTECTED</option><option value="INTERNAL">INTERNAL</option><option value="PUBLIC">PUBLIC</option><option value="UNKNOWN">UNKNOWN (blocked)</option><option value="CONFIDENTIAL">CONFIDENTIAL (blocked)</option></select></label></div>
        <DropZone accept={[".xlsx"]} maxMB={20} files={file ? [file] : []} onFiles={(fs) => takeFile(fs[0] || null)} onClear={() => takeFile(null)} title="Drop today’s G-CATS .xlsx here" hint="or click to browse · works from any account and any computer" label="G-CATS workbook" disabled={!!busy || !allowed} />
        {!allowed && <p className="gx-msg bad"><XCircle size={15} />CONFIDENTIAL and UNKNOWN files are never processed.</p>}
        {busy && <p className="gx-msg"><LoaderCircle size={15} className="spin" />{busy}</p>}
        {fileSource && file && !busy && <p className="gx-sub">Source: {fileSource}</p>}
        {error && <div className="gx-alert bad" role="alert"><AlertTriangle size={16} /><span>{error}</span></div>}
        {file && !busy && !preview && !error && !done && <button type="button" className="btn btn-primary" onClick={() => void inspectFile(file)}><FileSpreadsheet size={14} /> Check this file</button>}
        {file && error && <button type="button" className="btn" onClick={() => void inspectFile(file)}><RefreshCw size={14} /> Try again</button>}
        <details className="gx-more">
          <summary><ChevronRight size={14} /> Other ways to load the file</summary>
          <div className="gx-more-body">
            <div><b>Keep a file connected (this computer only)</b><p>Chrome / Edge remember a file on this computer and can check it for a new version. Other computers simply drop the file.</p>
              <div className="gx-row"><button type="button" className="btn btn-sm" onClick={() => void connectFile()}><FolderSync size={13} /> Connect a file</button><button type="button" className="btn btn-sm" onClick={() => void refreshFile()} disabled={!connected}><RefreshCw size={13} /> Check for a new version</button>
                <label className="gx-check"><input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} disabled={!connected} /> Check every</label>
                <select className="select-field" value={intervalSec} onChange={(e) => setIntervalSec(e.target.value)} disabled={!connected} aria-label="Check interval"><option value="30">30 s</option><option value="60">1 min</option><option value="300">5 min</option></select></div>
              {sourceStatus && <p className="gx-sub">{sourceStatus}</p>}</div>
            <div><b>SharePoint (server fetch)</b><p>Optional. Needs a Microsoft Graph app registration on the server; until then dropping the file is the way.</p>
              <div className="gx-row"><button type="button" className="btn btn-sm" onClick={() => void checkSharePoint()} disabled={spBusy}>Check SharePoint setup</button><button type="button" className="btn btn-sm" onClick={() => void fetchSharePoint()} disabled={spBusy || !allowed}>{spBusy ? <LoaderCircle size={13} className="spin" /> : <CloudUpload size={13} />} Fetch latest</button></div>
              {spStatus && <p className="gx-sub">{spStatus}</p>}</div>
          </div>
        </details>
      </section>

      <aside className="gx-card gx-sync" aria-labelledby="gx-sync-h">
        <div className="gx-head"><div><h2 id="gx-sync-h"><Sheet size={16} /> Excel register</h2><p>JudgementRegister sheet, updated by Power Automate</p></div>
          <span className={`gx-pill ${!sync ? "" : flowOn ? (failed ? "warn" : "ok") : "bad"}`}>{!sync ? "Checking…" : flowOn ? (failed ? "Needs attention" : "Connected") : "Not set up"}</span></div>
        {sync && !flowOn && <p className="gx-note">The register flow is not configured on the server (<code>POWER_AUTOMATE_EXCEL_URL</code> + <code>POWER_AUTOMATE_SECRET</code>). Imports and judgements still work; their rows wait in the queue and go to Excel once it is set up.</p>}
        <dl className="gx-stats"><div><dt>Waiting</dt><dd>{fmt(waiting)}</dd></div><div><dt>Failed</dt><dd className={failed ? "bad" : ""}>{fmt(failed)}</dd></div></dl>
        {sync?.lastError && failed > 0 && <p className="gx-note bad">Last error: {sync.lastError}</p>}
        <div className="gx-row"><button type="button" className="btn btn-sm" disabled={syncBusy || !flowOn || !waiting} onClick={() => void sendWaiting(false)}>{syncBusy ? <LoaderCircle size={13} className="spin" /> : <Send size={13} />} Send waiting rows</button><button type="button" className="btn btn-sm" disabled={syncBusy || !flowOn || !failed} onClick={() => void sendWaiting(true)}><RefreshCw size={13} /> Retry failed</button></div>
        {syncMsg && <p className="gx-sub">{syncMsg}</p>}
        <p className="gx-note">After every commit, all rows of that day go to the register by <code>code</code>: new rows appear with an empty Judge (not judged yet). Judgements made on the website follow automatically.</p>
        <details className="gx-more"><summary><ChevronRight size={14} /> How the daily update merges</summary>
          <ol className="gx-how"><li><b>Stable key.</b> TMA’s <code>code</code>; rows without one use Download Date + No., the same rule TMA uses later.</li><li><b>Source refreshed.</b> Error Type, part, supplier and status come from the newest file.</li><li><b>Judgements kept.</b> Assigned person, procedure, Judge, comments and KM fields edited on the website are never overwritten.</li><li><b>Nothing deleted.</b> Rows missing from a later file stay in the register.</li></ol></details>
      </aside>
    </div>

    {preview && <section className="gx-card gx-preview" aria-labelledby="gx-prev-h">
      <div className="gx-head"><div><h2 id="gx-prev-h">{preview.fileName}</h2><p>{preview.sheetName} · header row {preview.headerRow} · {fileSource || "dropped file"}</p></div><span className="gx-pill warn">Not committed yet</span></div>
      <p className="gx-lead"><b>{fmt(preview.rowCount)} rows</b> → <b>{fmt(preview.newRecords)} new</b>, {fmt(preview.refreshedRecords)} to refresh{preview.sameSnapshotRows ? `, ${fmt(preview.sameSnapshotRows)} unchanged` : ""} · {types.length} error type{types.length === 1 ? "" : "s"}.</p>
      <div className="gx-tiles">
        {[["Rows in file", preview.rowCount, ""], ["New records", preview.newRecords, "accent"], ["Existing to refresh", preview.refreshedRecords, ""], ["Unchanged", preview.sameSnapshotRows, "quiet"], ["Error types", types.length, ""], ["Judgement columns found", `${preview.judgementFieldsDetected}/9`, preview.judgementFieldsDetected < 9 ? "warn" : ""]].map(([l, v, t]) => <div key={String(l)} className={`gx-tile ${t}`}><span>{l}</span><strong>{typeof v === "number" ? fmt(v) : v}</strong></div>)}
      </div>
      <div className="gx-split">
        <div><h3>Error types in this file</h3><ul className="gx-bars">{types.map(([k, v]) => <li key={k}><span className="gx-bar-l">{k || "(blank)"}</span><span className="gx-bar"><i style={{ width: `${Math.max(4, (v / maxType) * 100)}%` }} /></span><b>{fmt(v)}</b></li>)}</ul></div>
        <div><h3>Checks</h3>{preview.warnings.length ? <ul className="gx-notes">{preview.warnings.map((w, i) => <li key={i}><AlertTriangle size={14} />{w}</li>)}</ul> : <p className="gx-msg ok"><CheckCircle2 size={15} />No mapping problems found.</p>}</div>
      </div>
      <h3>First rows</h3>
      <div className="gx-table"><table><thead><tr><th>Code</th><th>Part no.</th><th>Supplier</th><th>Error type</th><th>Assigned</th><th>Judge</th><th>KM judge</th></tr></thead><tbody>
        {preview.sampleRows.map((r, i) => <tr key={i}><td className="mono">{r.sourceCode ? String(r.sourceCode) : <span className="gx-muted">not judged yet</span>}</td><td className="mono">{String(r.deliveryPartNo || "—")}</td><td>{String(r.supplierCode || "—")}</td><td>{String(r.errorType || "—")}</td><td>{String(r.assignedPerson || "—")}</td><td>{String(r.sourceJudgeLabel || r.judge || "—")}</td><td>{String(r.sourceKmJudgeLabel || r.kmJudge || "—")}</td></tr>)}
      </tbody></table></div>
      <div className="gx-actions"><p>Commit updates the source fields and keeps every judgement made on the website.</p><button type="button" className="btn" onClick={() => { setPreview(null); setFile(null); }}>Discard</button><button type="button" className="btn btn-primary gx-go" disabled={committing} onClick={() => void commit()}>{committing ? <LoaderCircle size={15} className="spin" /> : <CheckCircle2 size={15} />} Commit {fmt(preview.rowCount)} rows</button></div>
    </section>}

    {done && <section className="gx-card gx-done" role="status">
      <span className="gx-done-ic"><CheckCircle2 size={22} /></span>
      <div><h2>{done.file} committed · {fmt(done.rows)} rows</h2>
        <p>{done.error ? `Register queue could not be filled: ${done.error}` : done.flowConfigured ? `${fmt(done.queued)} rows are on their way to the Excel register through Power Automate.` : `${fmt(done.queued)} rows wait for the register flow (not set up on the server yet).`}</p>
        <div className="gx-row"><a className="btn btn-sm" href="/judgement">Open Judgement</a><button type="button" className="btn btn-sm" onClick={() => setDone(null)}>Import another file</button></div></div>
    </section>}

    <section className="gx-card gx-history" aria-labelledby="gx-hist-h">
      <div className="gx-head"><div><h2 id="gx-hist-h">Recent imports</h2><p>Every file stays as a dated snapshot. “Preview only” means it was checked but never committed, so nothing changed.</p></div></div>
      {history.length ? <div className="gx-table"><table><thead><tr><th>When</th><th>File</th><th>Sheet</th><th className="r">Rows</th><th>Status</th></tr></thead><tbody>
        {history.map((b) => <tr key={b.id}><td title={new Date(b.created_at).toLocaleString()}>{ago(b.created_at)}</td><td className="gx-file">{b.file_name}</td><td className="gx-muted">{b.source_sheet}</td><td className="r mono">{fmt(b.committed_rows || b.total_rows)}</td><td>{b.status === "COMMITTED" ? <span className="gx-pill ok">Committed</span> : b.status === "FAILED" ? <span className="gx-pill bad">Failed</span> : <span className="gx-pill">Preview only</span>}</td></tr>)}
      </tbody></table></div> : <p className="gx-sub">No imports yet.</p>}
    </section>
  </div>;
}
