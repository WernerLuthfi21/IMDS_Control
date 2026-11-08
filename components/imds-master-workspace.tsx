"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { createClient } from "@/lib/supabase/client";

type MdRecord = {
  type?: string | null;
  name?: string | null;
  partNo?: string | null;
  idVersion?: string | null;
  status?: string | null;
  reasonForDenial?: string | null;
  lastStatusChanged?: string | null;
  fromCompany?: string | null;
  mdSupplierCode?: string | null;
  legacySparePart?: string | null;
  legacyStatus?: string | null;
  legacyLastStatusChanged?: string | null;
  followUpDate?: string | null;
  legacyReasonForDenial?: string | null;
  sourceRow?: number;
};

type MasterRow = {
  id: string;
  project: string | null;
  vendor_code: string | null;
  main_pic_email: string | null;
  company_name: string | null;
  part_name: string | null;
  part_no: string | null;
  submission_plan: string | null;
  supplier_promise_date: string | null;
  imds_status: string | null;
  imds_id_version: string | null;
  part_status: string | null;
  have_respond_email: string | null;
  status_update: string | null;
  md_id_version: string | null;
  md_status_update_date: string | null;
  comment: string | null;
  lpop_confirmation: string | null;
  cek: string | null;
  md_system_records: MdRecord[] | null;
  md_system_updated_at: string | null;
  manual_overrides: string[] | null;
  updated_at: string;
};

type ImportSummary = {
  success?: boolean;
  fileName?: string;
  totalRows?: number;
  inserted?: number;
  updated?: number;
  skipped?: number;
  contactsImported?: number;
  matchedMasterRows?: number;
  matchedSourceRows?: number;
  ambiguousRows?: number;
  unmatchedRows?: number;
  unmatchedPartNumbers?: number;
  skippedRows?: number;
  powerAutomate?: { configured?: boolean; sent?: number; failed?: number; pending?: number; error?: string };
  note?: string;
  error?: string;
};

type SupplierFollowup = {
  supplierCode: string;
  supplierName: string;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  partCount: number;
  projects: string[];
  emailReady: boolean;
  parts: Array<{ id: string; project: string | null; part_no: string | null; part_name: string | null; imds_status: string | null; submission_plan: string | null; sequence: number }>;
};

type FollowupDraft = { subject: string; body: string };

const EDIT_FIELDS = [
  { key: "main_pic_email", label: "Main PIC Email", type: "email" },
  { key: "submission_plan", label: "Submission Plan (Master)", type: "date" },
  { key: "supplier_promise_date", label: "Supplier Promise Date", type: "date" },
  { key: "imds_status", label: "IMDS Status", type: "text" },
  { key: "imds_id_version", label: "ID / Ver", type: "text" },
  { key: "part_status", label: "Part Status", type: "text" },
  { key: "vendor_code", label: "Vendor Code", type: "text" },
  { key: "comment", label: "Comment", type: "text" },
  { key: "lpop_confirmation", label: "LPOP Confirmation", type: "text" },
  { key: "cek", label: "CEK", type: "text" }
] as const;

const cardStyle: CSSProperties = {
  border: "1px solid var(--line, #e7eaed)",
  borderRadius: 10,
  background: "var(--surface, #fff)",
  padding: 16,
  boxShadow: "0 2px 12px rgba(16,24,40,.03), 0 4px 14px rgba(16,24,40,.025)"
};

function showDate(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value.length === 10 ? value + "T00:00:00" : value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("en-GB");
}

function firstMd(row: MasterRow): MdRecord | null {
  return row.md_system_records?.[0] || null;
}

export function ImdsMasterWorkspace({ canEdit }: { canEdit: boolean }) {
  const [rows, setRows] = useState<MasterRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [project, setProject] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<"master" | "mds" | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(null);
  const [latestMasterImport, setLatestMasterImport] = useState<Record<string, unknown> | null>(null);
  const [latestMdsImport, setLatestMdsImport] = useState<Record<string, unknown> | null>(null);
  const [editing, setEditing] = useState<MasterRow | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [followups, setFollowups] = useState<SupplierFollowup[]>([]);
  const [followupDrafts, setFollowupDrafts] = useState<Record<string, FollowupDraft>>({});
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [followupLoading, setFollowupLoading] = useState(false);
  const [sendingSupplier, setSendingSupplier] = useState<string | null>(null);
  const [sendAllBusy, setSendAllBusy] = useState(false);
  const [senders, setSenders] = useState<Array<{ name: string; email: string }>>([]);
  const [sender, setSender] = useState("");
  const [syncStatus, setSyncStatus] = useState<{ configured: boolean; queue: { pending: number; failed: number; sending: number; sent: number } } | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);

  const loadFollowups = useCallback(async () => {
    setFollowupLoading(true);
    try {
      const response = await fetch("/api/imds-master/followups", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not prepare supplier follow-ups.");
      const next = (payload.suppliers || []) as SupplierFollowup[];
      setFollowups(next);
      setEmailConfigured(Boolean(payload.configured));
      setSenders(Array.isArray(payload.senders) ? payload.senders : []);
      setFollowupDrafts((previous) => {
        const drafts = { ...previous };
        next.forEach((supplier) => {
          const key = supplier.supplierCode + "|" + supplier.supplierName;
          if (!drafts[key]) drafts[key] = { subject: supplier.subject, body: supplier.body };
        });
        return drafts;
      });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not prepare supplier follow-ups." });
    } finally {
      setFollowupLoading(false);
    }
  }, []);

  const loadSyncStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/imds-master/sync", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not read Excel sync queue.");
      setSyncStatus(payload);
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not read Excel sync queue." });
    }
  }, []);

  const syncNow = useCallback(async () => {
    setSyncBusy(true);
    try {
      const response = await fetch("/api/imds-master/sync", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Master sync failed.");
      setNotice({ kind: payload.failed ? "error" : "success", text: payload.configured
        ? `Excel sync: ${payload.sent} sent, ${payload.failed} failed, ${payload.pending} pending.`
        : `Excel sync is not configured yet. ${payload.pending} update batch(es) remain safely queued.` });
      await loadSyncStatus();
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Master sync failed." });
    } finally {
      setSyncBusy(false);
    }
  }, [loadSyncStatus]);

  const draftKey = (supplier: SupplierFollowup) => supplier.supplierCode + "|" + supplier.supplierName;

  async function sendSupplier(supplier: SupplierFollowup) {
    if (!emailConfigured) {
      setNotice({ kind: "error", text: "Supplier e-mail Flow is not configured yet. No e-mail was sent." });
      return false;
    }
    const key = draftKey(supplier);
    const draft = followupDrafts[key] || { subject: supplier.subject, body: supplier.body };
    setSendingSupplier(key);
    try {
      const response = await fetch("/api/imds-master/followups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplierCode: supplier.supplierCode, supplierName: supplier.supplierName, subject: draft.subject, messageBody: draft.body, sender: sender || undefined })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Supplier e-mail was not sent.");
      setNotice({ kind: "success", text: `Sent to ${supplier.supplierName}: ${payload.recipient} · ${payload.partCount} parts · PDF attached.` });
      return true;
    } catch (error) {
      setNotice({ kind: "error", text: `${supplier.supplierName}: ${error instanceof Error ? error.message : "Send failed."}` });
      return false;
    } finally {
      setSendingSupplier(null);
      await loadFollowups();
    }
  }

  async function sendAllSequentially() {
    const ready = followups.filter((supplier) => supplier.emailReady);
    if (!emailConfigured || !ready.length) return;
    setSendAllBusy(true);
    let sent = 0;
    let skippedRecent = 0;
    const failures: string[] = [];
    try {
      for (const supplier of ready) {
        const key = draftKey(supplier);
        const draft = followupDrafts[key] || { subject: supplier.subject, body: supplier.body };
        try {
          const response = await fetch("/api/imds-master/followups", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ supplierCode: supplier.supplierCode, supplierName: supplier.supplierName, subject: draft.subject, messageBody: draft.body, sender: sender || undefined })
          });
          const payload = await response.json();
          if (!response.ok) {
            if (payload.skipped === "RECENTLY_SENT") { skippedRecent++; continue; }
            throw new Error(payload.error || "Send failed.");
          }
          sent++;
        } catch (error) {
          failures.push(`${supplier.supplierName}: ${error instanceof Error ? error.message : "Send failed"}`);
        }
      }
      setNotice({ kind: failures.length ? "error" : "success", text: `Sequential supplier follow-up complete: ${sent}/${ready.length} sent. ${skippedRecent} skipped (already e-mailed recently). ${failures.length} failed. Each supplier was sent separately with its own PDF. ${failures.slice(0, 3).join(" | ")}` });
      await loadFollowups();
    } finally {
      setSendAllBusy(false);
    }
  }

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "50" });
      if (query.trim()) params.set("q", query.trim());
      if (project.trim()) params.set("project", project.trim());
      const response = await fetch("/api/imds-master/parts?" + params.toString(), { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not load master data.");
      setRows(payload.rows || []);
      setTotal(payload.total || 0);
      setLatestMasterImport(payload.latestMasterImport || null);
      setLatestMdsImport(payload.latestMdsImport || null);
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not load master data." });
    } finally {
      setLoading(false);
    }
  }, [page, query, project]);

  useEffect(() => {
    const timer = setTimeout(() => { void load(); }, 250);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const first = setTimeout(() => { void loadFollowups(); void loadSyncStatus(); }, 0);
    const timer = setInterval(() => {
      void loadFollowups();
      void loadSyncStatus();
    }, 30000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [loadFollowups, loadSyncStatus]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase?.channel("imds-master-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "imds_master_parts" }, () => { void load(); })
      .subscribe();
    const poll = setInterval(() => { void load(); }, 15000);
    return () => {
      clearInterval(poll);
      if (supabase && channel) void supabase.removeChannel(channel);
    };
  }, [load]);

  const projects = useMemo(() => [...new Set(rows.map((row) => row.project).filter(Boolean) as string[])].sort(), [rows]);
  const totalPages = Math.max(1, Math.ceil(total / 50));

  async function uploadFile(kind: "master" | "mds", file?: File) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setNotice({ kind: "error", text: "Please upload an .xlsx workbook." });
      return;
    }
    setUploading(kind);
    setNotice({ kind: "info", text: kind === "master" ? "Reading Part List LATEST and merging it into the shared master…" : "Reading MD System search results and matching part numbers…" });
    try {
      // 1) straight to private storage (no serverless body-size cap)  2) the server reads it from there
      const init = await fetch("/api/imds-master/upload-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: file.name, fileSize: file.size }) });
      const slot = await init.json().catch(() => ({})) as { path?: string; token?: string; error?: string };
      if (!init.ok || !slot.path || !slot.token) throw new Error(slot.error || "The upload could not start. Sign in again and retry.");
      const sb = createClient();
      if (!sb) throw new Error("Supabase is not configured in the browser.");
      const up = await sb.storage.from("import-staging").uploadToSignedUrl(slot.path, slot.token, file);
      if (up.error) throw new Error("Upload to storage failed: " + up.error.message);
      setNotice({ kind: "info", text: "File uploaded. Importing rows — large workbooks can take up to a minute…" });
      const response = await fetch(kind === "master" ? "/api/imds-master/import-master" : "/api/imds-master/import-md-system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storagePath: slot.path, fileName: file.name })
      });
      const raw = await response.text();
      let payload: ImportSummary;
      try { payload = JSON.parse(raw) as ImportSummary; }
      catch { throw new Error(response.status === 504 || /timeout|timed out/i.test(raw) ? "The import ran past the server time limit. Nothing is lost: try again, or split the workbook into smaller parts." : `The server returned an unexpected response (HTTP ${response.status}). Please retry.`); }
      if (!response.ok) throw new Error(payload.error || "Import failed.");
      const summary = kind === "master"
        ? `Master updated: ${payload.inserted || 0} new, ${payload.updated || 0} refreshed, ${payload.skipped || 0} skipped from ${payload.totalRows || 0} rows; ${payload.contactsImported || 0} supplier contacts synced.`
        : `MD System import: ${payload.matchedMasterRows || 0} master rows matched; ${payload.ambiguousRows || 0} ambiguous; ${payload.unmatchedRows || 0} unmatched.`;
      const sync = payload.powerAutomate ? ` Excel sync: ${payload.powerAutomate.sent || 0} sent / ${payload.powerAutomate.pending || 0} pending.` : "";
      setNotice({ kind: "success", text: summary + sync + (payload.note ? " " + payload.note : "") });
      setPage(1);
      await load();
      await loadFollowups();
      await loadSyncStatus();
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Import failed." });
    } finally {
      setUploading(null);
    }
  }

  function openEdit(row: MasterRow) {
    setEditing(row);
    const initial: Record<string, string> = {};
    for (const field of EDIT_FIELDS) initial[field.key] = String((row as unknown as Record<string, unknown>)[field.key] ?? "");
    setEditValues(initial);
  }

  async function saveEdit() {
    if (!editing) return;
    const changes: Record<string, unknown> = {};
    for (const field of EDIT_FIELDS) {
      const before = String((editing as unknown as Record<string, unknown>)[field.key] ?? "");
      const after = editValues[field.key] ?? "";
      if (before !== after) changes[field.key] = after || null;
    }
    if (!Object.keys(changes).length) {
      setEditing(null);
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/imds-master/parts/" + editing.id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes)
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not save changes.");
      const sync = payload.powerAutomate;
      setNotice({ kind: "success", text: sync?.configured
        ? `Master row saved and Excel sync: ${sync.sent || 0} sent / ${sync.pending || 0} pending.`
        : "Master row saved. Excel writeback will remain queued until the Power Automate Tracker Flow is configured." });
      setEditing(null);
      await load();
      await loadSyncStatus();
      await loadFollowups();
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not save changes." });
    } finally {
      setSaving(false);
    }
  }

  const stat = (label: string, value: string, detail: string) => (
    <div style={cardStyle}>
      <div style={{ color: "var(--muted, #77818c)", fontSize: 12, fontWeight: 650, letterSpacing: ".04em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 750, marginTop: 4, color: "var(--ink, #1f2933)" }}>{value}</div>
      <div style={{ color: "var(--muted, #77818c)", fontSize: 12, marginTop: 2 }}>{detail}</div>
    </div>
  );

  return (
    <div style={{ display: "grid", gap: 16, paddingBottom: 36 }}>
      {notice && (
        <div role="status" style={{ ...cardStyle, borderColor: notice.kind === "error" ? "#e7a4ad" : notice.kind === "success" ? "#91c8a9" : "var(--line, #e7eaed)", background: notice.kind === "error" ? "#fff3f4" : notice.kind === "success" ? "#f2fbf5" : "var(--surface, #fff)" }}>
          <div style={{ display: "flex", alignItems: "start", justifyContent: "space-between", gap: 12 }}>
            <span>{notice.text}</span>
            <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss message" style={{ border: 0, background: "transparent", cursor: "pointer", fontSize: 18 }}>×</button>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
        {stat("Master part rows", total.toLocaleString(), "Filtered rows currently found")}
        {stat("Current page", rows.length.toLocaleString(), `Page ${page} of ${totalPages}`)}
        {stat("MD System records", rows.filter((row) => (row.md_system_records || []).length > 0).length.toLocaleString(), "Rows with a matched result on this page")}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 14 }}>
        <label
          htmlFor="master-workbook-file"
          onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = "#167a45"; }}
          onDragLeave={(e) => { e.currentTarget.style.borderColor = "var(--line-strong, #b7d9c4)"; }}
          onDrop={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = "var(--line-strong, #b7d9c4)"; void uploadFile("master", e.dataTransfer.files?.[0]); }}
          style={{ ...cardStyle, borderStyle: "dashed", borderWidth: 2, borderColor: "var(--line-strong, #b7d9c4)", cursor: "pointer", minHeight: 140, display: "grid", alignContent: "center", gap: 6 }}
        >
          <input id="master-workbook-file" type="file" accept=".xlsx" hidden disabled={!canEdit || uploading !== null} onChange={(e) => { void uploadFile("master", e.target.files?.[0]); e.currentTarget.value = ""; }} />
          <strong style={{ fontSize: 15 }}>① Upload IMDS Remaining master</strong>
          <span style={{ color: "var(--muted, #77818c)", fontSize: 13 }}>Drop the workbook containing <b>Part List LATEST</b> here, or click to browse.</span>
          <span style={{ color: "var(--muted, #77818c)", fontSize: 12 }}>New rows are added. Missing rows are not deleted. Manual website edits are preserved.</span>
          {uploading === "master" && <span aria-live="polite">Importing master workbook…</span>}
        </label>

        <label
          htmlFor="md-system-file"
          onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = "#167a45"; }}
          onDragLeave={(e) => { e.currentTarget.style.borderColor = "var(--line-strong, #b7d9c4)"; }}
          onDrop={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = "var(--line-strong, #b7d9c4)"; void uploadFile("mds", e.dataTransfer.files?.[0]); }}
          style={{ ...cardStyle, borderStyle: "dashed", borderWidth: 2, borderColor: "var(--line-strong, #b7d9c4)", cursor: "pointer", minHeight: 140, display: "grid", alignContent: "center", gap: 6 }}
        >
          <input id="md-system-file" type="file" accept=".xlsx" hidden disabled={!canEdit || uploading !== null} onChange={(e) => { void uploadFile("mds", e.target.files?.[0]); e.currentTarget.value = ""; }} />
          <strong style={{ fontSize: 15 }}>② Upload MD System search results</strong>
          <span style={{ color: "var(--muted, #77818c)", fontSize: 13 }}>Drop the Search Results workbook here, or click to browse.</span>
          <span style={{ color: "var(--muted, #77818c)", fontSize: 12 }}>Matched by Part/Item No. + supplier code (with company-name check). Ambiguous rows are saved for review; only MD System fields are updated.</span>
          {uploading === "mds" && <span aria-live="polite">Matching MD System records…</span>}
        </label>
      </div>

      <div style={{ ...cardStyle, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ minWidth: 220, flex: 1 }}>
          <strong>Master workbook history</strong>
          <div style={{ fontSize: 12, color: "var(--muted, #77818c)", marginTop: 4 }}>
            {latestMasterImport ? `${String(latestMasterImport.file_name)} · ${String(latestMasterImport.created_at)} · ${String(latestMasterImport.inserted_rows)} new / ${String(latestMasterImport.updated_rows)} refreshed` : "No master workbook uploaded yet."}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted, #77818c)", marginTop: 3 }}>
            {latestMdsImport ? `Latest MD System: ${String(latestMdsImport.file_name)} · ${String(latestMdsImport.matched_master_rows)} matched / ${String(latestMdsImport.unmatched_part_numbers)} unmatched part numbers` : "No MD System search results uploaded yet."}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "var(--muted, #77818c)" }}>
            Excel Flow: {syncStatus?.configured ? "connected" : "not configured"} · Queue: {syncStatus?.queue.pending || 0} pending / {syncStatus?.queue.failed || 0} failed
          </span>
          <button type="button" className="btn btn-secondary" disabled={syncBusy || !syncStatus || (syncStatus.queue.pending + syncStatus.queue.failed === 0)} onClick={() => void syncNow()}>{syncBusy ? "Syncing…" : "Sync now"}</button>
          <a href="/api/imds-master/export" className="btn btn-primary" style={{ textDecoration: "none", whiteSpace: "nowrap" }}>Download Super Master XLSX</a>
        </div>
      </div>

      <section style={{ ...cardStyle, display: "grid", gap: 12 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
          <div>
            <strong style={{ fontSize: 16 }}>Supplier follow-up automation</strong>
            <div style={{ color: "var(--muted, #77818c)", fontSize: 12, marginTop: 4 }}>
              {emailConfigured ? "Power Automate e-mail Flow connected." : "Power Automate e-mail Flow not configured. Preview is available; sending is disabled."}
              {" "}Each supplier receives a separate message and its own PDF report.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {senders.length > 0 && (
              <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
                Send as
                <select value={sender} onChange={(event) => setSender(event.target.value)} disabled={sendAllBusy || sendingSupplier !== null}>
                  <option value="">Default account</option>
                  {senders.map((item) => <option key={item.email} value={item.email}>{item.name} &lt;{item.email}&gt;</option>)}
                </select>
              </label>
            )}
            <button type="button" className="btn btn-secondary" onClick={() => void loadFollowups()} disabled={followupLoading}>{followupLoading ? "Refreshing…" : "Refresh suppliers"}</button>
            <button type="button" className="btn btn-primary" onClick={() => void sendAllSequentially()} disabled={!emailConfigured || sendAllBusy || sendingSupplier !== null || !followups.some((item) => item.emailReady)}>
              {sendAllBusy ? "Sending one by one…" : `Send all sequentially (${followups.filter((item) => item.emailReady).length})`}
            </button>
          </div>
        </div>
        {followupLoading && followups.length === 0 ? (
          <div style={{ color: "var(--muted, #77818c)", fontSize: 13 }}>Preparing supplier groups…</div>
        ) : followups.length === 0 ? (
          <div style={{ color: "var(--muted, #77818c)", fontSize: 13 }}>No outstanding suppliers were found in the current master.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {followups.map((supplier) => {
              const key = draftKey(supplier);
              const draft = followupDrafts[key] || { subject: supplier.subject, body: supplier.body };
              return (
                <details key={key} style={{ border: "1px solid var(--line, #e7eaed)", borderRadius: 10, padding: 12 }}>
                  <summary style={{ cursor: "pointer", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <strong>{supplier.supplierName}</strong>
                    <span style={{ color: "var(--muted, #77818c)", fontSize: 12 }}>{supplier.supplierCode || "No vendor code"} · {supplier.partCount} parts · To: {supplier.to.join("; ") || "PIC missing"}</span>
                    <span style={{ marginLeft: "auto", fontSize: 12, color: supplier.emailReady ? "#15803d" : "#b45309" }}>{supplier.emailReady ? "Ready" : "PIC required"}</span>
                  </summary>
                  <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                    <div style={{ fontSize: 12, color: "var(--muted, #77818c)" }}>To: {supplier.to.join("; ") || "No valid PIC"}{supplier.cc.length ? ` · CC: ${supplier.cc.join("; ")}` : ""}</div>
                    <label style={{ display: "grid", gap: 4, fontSize: 12, fontWeight: 600 }}>Subject
                      <input value={draft.subject} onChange={(e) => setFollowupDrafts((p) => ({ ...p, [key]: { ...draft, subject: e.target.value } }))} style={{ minHeight: 38, border: "1px solid var(--line-strong, #ddd)", borderRadius: 8, padding: "7px 10px", background: "var(--surface-2, #fafbfc)" }} />
                    </label>
                    <label style={{ display: "grid", gap: 4, fontSize: 12, fontWeight: 600 }}>Message
                      <textarea value={draft.body} onChange={(e) => setFollowupDrafts((p) => ({ ...p, [key]: { ...draft, body: e.target.value } }))} rows={8} style={{ width: "100%", border: "1px solid var(--line-strong, #ddd)", borderRadius: 8, padding: 10, background: "var(--surface-2, #fafbfc)", font: "inherit", fontSize: 13 }} />
                    </label>
                    <div style={{ fontSize: 12, color: "var(--muted, #77818c)" }}>PDF attachment: IMDS_Outstanding_{supplier.supplierCode || "SUPPLIER"}_[date].pdf · {supplier.parts.length} part(s)</div>
                    <button type="button" className="btn btn-primary" style={{ justifySelf: "start" }} disabled={!emailConfigured || !supplier.emailReady || sendingSupplier === key || sendAllBusy} onClick={() => void sendSupplier(supplier)}>
                      {sendingSupplier === key ? "Sending…" : "Send to this supplier"}
                    </button>
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </section>

      <div style={{ ...cardStyle, display: "grid", gap: 12 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={query}
            onChange={(e) => { setPage(1); setQuery(e.target.value); }}
            placeholder="Search part number, supplier, part name, vendor code…"
            aria-label="Search master data"
            style={{ flex: "2 1 280px", minHeight: 40, padding: "8px 12px", border: "1px solid var(--line-strong, #ddd)", borderRadius: 9, background: "var(--surface-2, #fafbfc)" }}
          />
          <input
            value={project}
            onChange={(e) => { setPage(1); setProject(e.target.value); }}
            placeholder="Filter project (e.g. 737D)"
            aria-label="Filter by project"
            list="imds-master-projects"
            style={{ flex: "1 1 150px", minHeight: 40, padding: "8px 12px", border: "1px solid var(--line-strong, #ddd)", borderRadius: 9, background: "var(--surface-2, #fafbfc)" }}
          />
          <datalist id="imds-master-projects">{projects.map((name) => <option key={name} value={name} />)}</datalist>
          <button type="button" className="btn btn-secondary" onClick={() => void load()}>Refresh</button>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1080, fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", background: "var(--surface-2, #fafbfc)" }}>
                {["Project", "Supplier", "Vendor", "P/No.", "Part Name", "Submission Plan", "Supplier Promise", "IMDS Status", "Part Status", "MD System Status", "MD ID / Ver", "Updated", "Action"].map((title) => (
                  <th key={title} scope="col" style={{ padding: "11px 9px", borderBottom: "1px solid var(--line, #eee)", whiteSpace: "nowrap" }}>{title}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={13} style={{ padding: 24, textAlign: "center", color: "var(--muted, #77818c)" }}>Loading shared master…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={12} style={{ padding: 24, textAlign: "center", color: "var(--muted, #77818c)" }}>No master rows found. Upload the IMDS Remaining workbook to initialise the shared master.</td></tr>
              ) : rows.map((row) => {
                const md = firstMd(row);
                const mdStatus = md?.status || "Not matched";
                return (
                  <tr key={row.id} style={{ borderBottom: "1px solid var(--line, #eee)" }}>
                    <td style={{ padding: "10px 9px", whiteSpace: "nowrap" }}>{row.project || "—"}</td>
                    <td style={{ padding: "10px 9px", minWidth: 190 }}>{row.company_name || "—"}</td>
                    <td style={{ padding: "10px 9px" }}>{row.vendor_code || "—"}</td>
                    <td style={{ padding: "10px 9px", fontFamily: "var(--font-mono, monospace)", whiteSpace: "nowrap" }}>{row.part_no || "—"}</td>
                    <td style={{ padding: "10px 9px", minWidth: 180 }}>{row.part_name || "—"}</td>
                    <td style={{ padding: "10px 9px", whiteSpace: "nowrap" }}>{showDate(row.submission_plan)}</td>
                    <td style={{ padding: "10px 9px", whiteSpace: "nowrap" }}>{showDate(row.supplier_promise_date)}</td>
                    <td style={{ padding: "10px 9px" }}>{row.imds_status || "—"}</td>
                    <td style={{ padding: "10px 9px" }}>{row.part_status || "—"}</td>
                    <td style={{ padding: "10px 9px", minWidth: 130 }}>
                      <span>{mdStatus}</span>
                      {(row.md_system_records || []).length > 1 && <span style={{ display: "block", color: "var(--muted, #77818c)", fontSize: 11 }}>{row.md_system_records?.length} MD System matches</span>}
                      {md?.lastStatusChanged && <span style={{ display: "block", color: "var(--muted, #77818c)", fontSize: 11 }}>{showDate(md.lastStatusChanged)}</span>}
                    </td>
                    <td style={{ padding: "10px 9px", whiteSpace: "nowrap" }}>{md?.idVersion || row.md_id_version || "—"}</td>
                    <td style={{ padding: "10px 9px", whiteSpace: "nowrap", color: "var(--muted, #77818c)" }}>{showDate(row.updated_at)}</td>
                    <td style={{ padding: "10px 9px" }}>
                      <button type="button" className="btn btn-secondary btn-sm" disabled={!canEdit} onClick={() => openEdit(row)}>Edit</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--muted, #77818c)" }}>{total.toLocaleString()} master rows · Showing {rows.length ? ((page - 1) * 50 + 1).toLocaleString() : 0}–{Math.min(page * 50, total).toLocaleString()}</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button>
            <span style={{ alignSelf: "center", fontSize: 12 }}>Page {page} / {totalPages}</span>
            <button type="button" className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</button>
          </div>
        </div>
      </div>

      {editing && (
        <div role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setEditing(null); }} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(20,10,35,.45)", display: "grid", placeItems: "center", padding: 16 }}>
          <section role="dialog" aria-modal="true" aria-labelledby="edit-master-heading" style={{ width: "min(760px,100%)", maxHeight: "90vh", overflow: "auto", borderRadius: 16, background: "var(--surface, #fff)", padding: 22, boxShadow: "0 20px 80px rgba(0,0,0,.24)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start", marginBottom: 16 }}>
              <div>
                <h2 id="edit-master-heading" style={{ fontSize: 20, margin: 0 }}>Edit master part</h2>
                <p style={{ color: "var(--muted, #77818c)", fontSize: 13, marginTop: 5 }}>{editing.project} · {editing.company_name} · {editing.part_no}</p>
              </div>
              <button type="button" onClick={() => setEditing(null)} aria-label="Close edit dialog" style={{ border: 0, background: "transparent", cursor: "pointer", fontSize: 24 }}>×</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
              {EDIT_FIELDS.map((field) => (
                <label key={field.key} style={{ display: "grid", gap: 5, fontSize: 13, fontWeight: 600 }}>
                  {field.label}
                  <input
                    type={field.type}
                    value={editValues[field.key] || ""}
                    onChange={(e) => setEditValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    style={{ minHeight: 40, border: "1px solid var(--line-strong, #ddd)", borderRadius: 8, padding: "8px 10px", background: "var(--surface-2, #fafbfc)", fontWeight: 400 }}
                  />
                </label>
              ))}
            </div>
            <p style={{ color: "var(--muted, #77818c)", fontSize: 12, marginTop: 14 }}>Manual changes are stored in the shared database and protected from later workbook refreshes for the fields you change.</p>
            <div style={{ display: "flex", justifyContent: "end", gap: 8, marginTop: 18 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void saveEdit()}>{saving ? "Saving…" : "Save master changes"}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
