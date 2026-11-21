"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DropZone } from "@/components/drop-zone";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, FileText, Inbox, LoaderCircle, Lock, WandSparkles } from "lucide-react";
import { confirmAction, TYPE_TO_CONFIRM_FROM } from "@/components/ui/confirm-dialog";

type Submission = { id: string; supplier_code: string; delivery_part_no: string; mds_status: string | null; workflow_status: string; review_comment?: string | null; reviewed_at?: string | null; source_verified_by_human?: boolean; attachment_path?: string | null; attachment_name?: string | null; created_at: string };
type Extracted = { supplierCode?: string; supplierName?: string; deliveryPartNo?: string; deliveryPartName?: string; mdsId?: string; mdsVersion?: string; mdsStatus?: string; preliminaryMds?: boolean | null };
type Preview = { fileName: string; sheetName: string; headerRow: number; fields: Extracted; detected: string[]; warnings: string[]; sourceFormat: string };

export function SupplierPrecheck({ role, supplierCode }: { role: string; supplierCode: string | null }) {
  const [file, setFile] = useState<File | null>(null);
  const [classification, setClassification] = useState("PROTECTED");
  const [supplier, setSupplier] = useState(supplierCode || "");
  const [supplierName, setSupplierName] = useState("");
  const [partNo, setPartNo] = useState("");
  const [partName, setPartName] = useState("");
  const [mdsId, setMdsId] = useState("");
  const [version, setVersion] = useState("");
  const [mdsStatus, setMdsStatus] = useState("Internally released");
  const [preliminary, setPreliminary] = useState("No");
  const [notes, setNotes] = useState("");
  const [attachmentPath, setAttachmentPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const isSupplier = role === "supplier";
  const canReview = ["admin", "preparer", "reviewer"].includes(role);
  const canClear = ["admin", "reviewer"].includes(role);

  async function refresh() {
    try {
      const [a, b] = await Promise.all([fetch("/api/prechecks"), fetch("/api/followups")]);
      const ja = await a.json(), jb = await b.json();
      if (a.ok) setSubmissions(ja.submissions || []);
      if (b.ok) setNotifications(jb.followups || []);
    } catch { /* Keep the form usable if refresh fails. */ }
  }
  useEffect(() => { void refresh(); const timer = window.setInterval(() => { void refresh(); }, 30000); return () => window.clearInterval(timer); }, []);

  async function updateReview(id: string, status: "INTERNAL_REVIEW" | "NEED_SUPPLIER_ACTION" | "CLEARED_FOR_IMDS" | "REJECTED") {
    setError(""); setSuccess("");
    if (status === "CLEARED_FOR_IMDS") {
      const verified = await confirmAction({
        title: "Clear this MDS for IMDS?",
        body: "Confirm that you personally checked the original IMDS source and confirmed the MDS is internally released, final (not preliminary), and has the expected supplier / part / IMDS ID / version. The supplied sample MDS PDF is never parsed automatically.",
        confirmLabel: "I checked it — clear for IMDS"
      });
      if (!verified) return;
    }
    const comment = status === "INTERNAL_REVIEW" ? "Review started." : window.prompt("Enter the review note that the supplier / next reviewer will see:", status === "CLEARED_FOR_IMDS" ? "Original MDS checked in IMDS. Internally released and final version confirmed." : "Please provide the missing information or correction.");
    if (comment === null) return;
    try {
      const r = await fetch(`/api/prechecks/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, comment, sourceVerifiedByHuman: status === "CLEARED_FOR_IMDS" }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || "Could not update pre-check review status.");
      setSuccess(`Pre-check ${id.slice(0, 8)} updated to ${status}.`); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Review update failed."); }
  }

  function setAttachment(next: File | null) {
    setFile(next); setAttachmentPath(null); setPreview(null); setError(""); setSuccess("");
  }

  async function ensureAttachmentUploaded() {
    if (!file) return null;
    if (attachmentPath) return attachmentPath;
    const init = await fetch("/api/prechecks/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: file.name, fileSize: file.size, classification }) });
    const initJson = await init.json();
    if (!init.ok) throw new Error(initJson.error || "Attachment upload could not be initialized.");
    const supabase = createClient();
    if (!supabase) throw new Error("Supabase is not configured.");
    const up = await supabase.storage.from("supplier-precheck-private").uploadToSignedUrl(initJson.path, initJson.token, file);
    if (up.error) throw new Error(up.error.message);
    setAttachmentPath(initJson.path);
    return initJson.path as string;
  }

  async function previewAttachment() {
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "pdf") { setError("The supplied MDS Report PDF explicitly prohibits parsing. Attach it for manual review instead."); return; }
    if (!(ext === "xlsx" || ext === "csv")) { setError("Only XLSX or CSV can be previewed."); return; }
    setParsing(true); setError(""); setSuccess(""); setPreview(null);
    try {
      const path = await ensureAttachmentUploaded();
      const response = await fetch("/api/prechecks/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storagePath: path, fileName: file.name, classification }) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Could not inspect the workbook.");
      const result = json.preview as Preview;
      setPreview(result);
      const f = result.fields || {};
      if (f.supplierCode) setSupplier(f.supplierCode);
      if (f.supplierName) setSupplierName(f.supplierName);
      if (f.deliveryPartNo) setPartNo(f.deliveryPartNo);
      if (f.deliveryPartName) setPartName(f.deliveryPartName);
      if (f.mdsId) setMdsId(f.mdsId);
      if (f.mdsVersion) setVersion(f.mdsVersion);
      if (f.mdsStatus) setMdsStatus(f.mdsStatus);
      if (typeof f.preliminaryMds === "boolean") setPreliminary(f.preliminaryMds ? "Yes" : "No");
      setSuccess("Excel/CSV fields were extracted into the form. Review and correct every field before submitting.");
    } catch (e) { setError(e instanceof Error ? e.message : "Attachment preview failed."); }
    finally { setParsing(false); }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError(""); setSuccess("");
    try {
      const path = await ensureAttachmentUploaded();
      const preliminaryMds = preliminary === "Yes" ? true : preliminary === "No" ? false : null;
      const r = await fetch("/api/prechecks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ supplierCode: supplier, supplierName, deliveryPartNo: partNo, deliveryPartName: partName, mdsId, mdsVersion: version, mdsStatus, preliminaryMds, notes, attachmentPath: path, attachmentName: file?.name || null, extractedFields: preview?.fields || {}, extractionWarnings: preview?.warnings || [] }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || "Pre-check submission failed.");
      setSuccess(`Pre-check submitted. Reference ${j.submission.id.slice(0, 8)} · Status: ${j.submission.workflow_status}. It is not automatically cleared for IMDS submission.`);
      setAttachment(null); setPartNo(""); setPartName(""); setMdsId(""); setVersion(""); setNotes(""); setPreview(null); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Submission failed"); }
    finally { setLoading(false); }
  }

  return <div className="supplier-precheck-page">
    <div className="two-col">
      <section className="simple-card">
        <div className="simple-card-head"><div><h2>{isSupplier ? "Submit a pre-check" : "Supplier pre-check workspace"}</h2><p>Import authorised structured data or enter the required values once. Review every extracted value before submission.</p></div><Inbox size={18}/></div>
        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="form-field"><label htmlFor="supplier-precheck-supplier-code">Supplier Code</label><input id="supplier-precheck-supplier-code" className="field" value={supplier} onChange={e => setSupplier(e.target.value)} disabled={isSupplier} required placeholder="Supplier code"/></div>
            <div className="form-field"><label htmlFor="supplier-precheck-supplier-name">Supplier Name</label><input id="supplier-precheck-supplier-name" className="field" value={supplierName} onChange={e => setSupplierName(e.target.value)} placeholder="Company name"/></div>
            <div className="form-field"><label htmlFor="supplier-precheck-delivery-part-no">Delivery Part No.</label><input id="supplier-precheck-delivery-part-no" className="field" value={partNo} onChange={e => setPartNo(e.target.value)} required placeholder="Toyota part number"/></div>
            <div className="form-field"><label htmlFor="supplier-precheck-delivery-part-name">Delivery Part Name</label><input id="supplier-precheck-delivery-part-name" className="field" value={partName} onChange={e => setPartName(e.target.value)} placeholder="Part name / description"/></div>
            <div className="form-field"><label htmlFor="supplier-precheck-imds-id">IMDS ID</label><input id="supplier-precheck-imds-id" className="field" value={mdsId} onChange={e => setMdsId(e.target.value)} placeholder="MDS ID"/></div>
            <div className="form-field"><label htmlFor="supplier-precheck-imds-version">IMDS Version</label><input id="supplier-precheck-imds-version" className="field" value={version} onChange={e => setVersion(e.target.value)} placeholder="Version"/></div>
            <div className="form-field"><label htmlFor="supplier-precheck-mds-status">MDS Status</label><select id="supplier-precheck-mds-status" className="select-field" value={mdsStatus} onChange={e => setMdsStatus(e.target.value)}><option>Internally released</option><option>Draft</option><option>Sent</option><option>Accepted</option><option>Rejected</option><option>Unknown</option></select><span className="form-hint">Self-reported status; the reviewer confirms it in IMDS.</span></div>
            <div className="form-field"><label htmlFor="supplier-precheck-preliminary-mds">Preliminary MDS?</label><select id="supplier-precheck-preliminary-mds" className="select-field" value={preliminary} onChange={e => setPreliminary(e.target.value)}><option>No</option><option>Yes</option><option>Unknown</option></select></div>
          </div>
          <div style={{ marginTop: 13 }}>
            <DropZone accept={[".xlsx", ".csv", ".pdf"]} maxMB={20} files={file ? [file] : []} onFiles={(fs) => setAttachment(fs[0])} onClear={() => setAttachment(null)} title="Drop the supplier Excel / CSV / MDS Report PDF" hint="XLSX / CSV are previewed; a PDF is attached for manual review" label="Supplier file"/>
          </div>
          {file && !file.name.toLowerCase().endsWith(".pdf") && <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 9 }}><button className="btn" type="button" onClick={previewAttachment} disabled={parsing || !["PROTECTED", "INTERNAL", "PUBLIC"].includes(classification)}>{parsing ? <LoaderCircle size={13} className="spin"/> : <WandSparkles size={13}/>} Read Excel / CSV and fill fields</button></div>}
          {file?.name.toLowerCase().endsWith(".pdf") && <div className="callout callout-danger" style={{ marginTop: 10 }}><AlertTriangle size={14}/><span><strong>MDS Report PDF will not be parsed.</strong> The supplied sample report states that parsing is not allowed. It may be attached for authorised manual review only.</span></div>}
          {preview && <div className="callout callout-info" style={{ marginTop: 10 }}><FileSpreadsheet size={14}/><span><strong>Previewed {preview.fileName}</strong> · sheet {preview.sheetName}, header row {preview.headerRow}. Detected: {preview.detected.join(", ") || "no known fields"}. {preview.warnings.join(" ")}</span></div>}
          <div className="form-field" style={{ marginTop: 12 }}><label htmlFor="supplier-precheck-additional-notes">Additional notes</label><textarea id="supplier-precheck-additional-notes" className="textarea-field" rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Supplier notes or known exceptions…"/></div>
          <div className="form-field" style={{ marginTop: 10 }}><label htmlFor="supplier-precheck-attachment-classification">Attachment classification</label><select id="supplier-precheck-attachment-classification" className="select-field" value={classification} onChange={e => { setClassification(e.target.value); setAttachmentPath(null); setPreview(null); }}><option value="PROTECTED">PROTECTED</option><option value="INTERNAL">INTERNAL</option><option value="PUBLIC">PUBLIC</option><option value="UNKNOWN">UNKNOWN — blocked</option><option value="CONFIDENTIAL">CONFIDENTIAL — blocked</option></select></div>
          {error && <div className="callout callout-danger" style={{ marginTop: 11 }}><AlertTriangle size={14}/>{error}</div>}{success && <div className="callout callout-success" style={{ marginTop: 11 }}><CheckCircle2 size={14}/>{success}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 13 }}><button className="btn btn-primary" disabled={loading || !supplier || !partNo || !["PROTECTED", "INTERNAL", "PUBLIC"].includes(classification)}>{loading ? <LoaderCircle size={14} className="spin"/> : <CheckCircle2 size={14}/>} Submit for pre-check</button></div>
        </form>
      </section>
      <aside className="simple-card pc-info"><div className="simple-card-head"><div><h2>What this pre-check does</h2><p>Readiness checks, not a replacement for IMDS or G-CATS.</p></div><Lock size={16}/></div>
        <div className="checklist">
          <div><CheckCircle2/><span><strong>Structured Excel / CSV input</strong><small>Recognises familiar headers and fills the form. All extracted fields remain editable for confirmation.</small></span></div>
          <div><CheckCircle2/><span><strong>Supplier Code and Part No.</strong><small>Required to create a traceable pre-check record.</small></span></div>
          <div><CheckCircle2/><span><strong>Internally released status</strong><small>Self-reported status; reviewer confirms it is the final version in IMDS.</small></span></div>
          <div><FileText/><span><strong>MDS Report PDF</strong><small>Attachment-only manual review due to the sample report's no-parsing notice.</small></span></div>
        </div>
        <div className="callout callout-info" style={{ marginTop: 13 }}>A submission receives <strong>SUBMITTED</strong> status. It cannot be marked CLEARED_FOR_IMDS automatically by these basic checks.</div>
      </aside>
    </div>
    {isSupplier && <section className="simple-card" style={{ marginTop: 13 }}><div className="simple-card-head"><div><h2>Notifications from Toyota</h2><p>Follow-up requests visible to this supplier account.</p></div><span className="quiet-badge">SUPPLIER INBOX</span></div>{notifications.length ? notifications.map((n: any) => <div className="notification-row" key={n.id}><div><strong>{n.subject}</strong><small>{n.message_body}</small><span>{new Date(n.created_at).toLocaleString()}</span></div><span className="state-pill state-pending">{n.status}</span></div>) : <div className="empty-note">No follow-up notifications at the moment.</div>}</section>}
    {error && <div className="callout callout-danger" style={{ marginTop: 11 }}><AlertTriangle size={14}/>{error}</div>}
    {success && <div className="callout callout-success" style={{ marginTop: 11 }}><CheckCircle2 size={14}/>{success}</div>}
    <section className="simple-card" style={{ marginTop: 13 }}><div className="simple-card-head"><div><h2>{isSupplier ? "My pre-check submissions" : "Supplier submissions & internal review"}</h2><p>{isSupplier ? "Track feedback before submitting to IMDS." : "Review source status and return a clear outcome to the supplier."}</p></div><span className="quiet-badge">{submissions.length} SHOWN</span></div>{submissions.length ? <div className="table-scroll"><table><thead><tr><th>Submitted</th><th>Supplier</th><th>Part No.</th><th>MDS Status</th><th>Workflow</th><th>Review note</th><th>Attachment</th>{canReview&&<th>Action</th>}</tr></thead><tbody>{submissions.map(s => <tr key={s.id}><td>{new Date(s.created_at).toLocaleDateString()}</td><td className="mono">{s.supplier_code}</td><td className="cell-strong">{s.delivery_part_no}</td><td>{s.mds_status || "—"}</td><td><span className={`state-pill ${s.workflow_status === "CLEARED_FOR_IMDS" ? "state-ok" : s.workflow_status === "REJECTED" || s.workflow_status === "NEED_SUPPLIER_ACTION" ? "state-ng" : "state-pending"}`}>{s.workflow_status}</span></td><td>{s.review_comment || "—"}</td><td>{s.attachment_path ? <a className="text-link" href={`/api/prechecks/${s.id}/attachment`} target="_blank" rel="noreferrer">{s.attachment_name || "Open attachment"}</a> : "—"}</td>{canReview&&<td><div className="precheck-actions"><button className="btn btn-sm" type="button" onClick={() => void updateReview(s.id, "INTERNAL_REVIEW")}>Review</button><button className="btn btn-sm" type="button" onClick={() => void updateReview(s.id, "NEED_SUPPLIER_ACTION")}>Request info</button>{canClear&&<button className="btn btn-sm btn-primary" type="button" onClick={() => void updateReview(s.id, "CLEARED_FOR_IMDS")}>Clear for IMDS</button>}</div></td>}</tr>)}</tbody></table></div> : <div className="empty-note">No submissions yet.</div>}{canReview&&<p className="form-hint" style={{marginTop:10}}>Clear for IMDS is available only to TMA reviewer/admin and requires an explicit human confirmation of the original IMDS source, internally released status, final version, IMDS ID and Version. It never follows from file parsing alone.</p>}</section>
  </div>;
}
