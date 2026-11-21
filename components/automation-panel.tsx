"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Circle, Download, Mail, RefreshCw, Send } from "lucide-react";
import { renderFollowup } from "@/lib/automation/render";

type Status = { configured: { excel: boolean; email: boolean; secret: boolean }; transport?: { excel: string | null; email: string | null }; counts: Record<string, number>; lastError: string | null; failed?: { id: string; kind: string; error: string | null; attempts: number; at: string }[] };
type Cand = { id: string; source_record_key: string; delivery_part_no: string | null; supplier_code: string; error_type_label: string; hasContact: boolean; followup: string | null };
type Result = { id: string; state: "wait" | "sending" | "SENT" | "FAILED" | "SKIPPED"; note?: string };
const TRANSPORT: Record<string, string> = { http: "direct (HTTP)", mail: "via mailbox" };

function Step({ ok, label, detail, action }: { ok: boolean; label: string; detail?: string; action?: React.ReactNode }) {
  return <li style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "6px 0" }}>{ok ? <CheckCircle2 size={16} color="#166534"/> : <Circle size={16} color="#a16207"/>}
      <div style={{ flex: 1 }}><strong>{label}</strong>{detail && <div style={{ fontSize: 12, color: "var(--muted)" }}>{detail}</div>}</div>{action}</li>
}

export function AutomationPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [cands, setCands] = useState<Cand[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, Result>>({});
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState("");
  const [q, setQ] = useState(""); const [type, setType] = useState("All"); const [preview, setPreview] = useState<string | null>(null);
  const [testing, setTesting] = useState<string>(""); const [testNote, setTestNote] = useState<Record<string, { ok: boolean; text: string }>>({});

  const load = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([fetch("/api/automation/status", { cache: "no-store" }), fetch("/api/automation/candidates", { cache: "no-store" })]);
      if (s.ok) setStatus(await s.json());
      if (c.ok) setCands((await c.json()).candidates || []);
    } catch { /* offline preview */ }
  }, []);
  useEffect(() => { const t = setTimeout(() => { void load(); }, 0); return () => clearTimeout(t); }, [load]);

  const types = useMemo(() => ["All", ...Array.from(new Set(cands.map((c) => c.error_type_label))).sort()], [cands]);
  const shown = useMemo(() => cands.filter((c) => (type === "All" || c.error_type_label === type) && (!q || [c.delivery_part_no, c.supplier_code, c.error_type_label].some((v) => String(v || "").toLowerCase().includes(q.toLowerCase())))), [cands, q, type]);
  const sendable = shown.filter((c) => c.hasContact && c.followup !== "SENT");
  const allOn = sendable.length > 0 && sendable.every((c) => picked.has(c.id));
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const doneCount = Object.values(results).filter((r) => r.state === "SENT" || r.state === "FAILED" || r.state === "SKIPPED").length;
  const total = Object.keys(results).length;
  const previewRow = cands.find((c) => c.id === preview);
  const previewMsg = previewRow ? renderFollowup({ errorType: previewRow.error_type_label, supplierCode: previewRow.supplier_code, partNo: previewRow.delivery_part_no || "" }) : null;

  async function syncNow(retryFailed = false) {
    setMsg("");
    const r = await fetch("/api/automation/dispatch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ retryFailed }) });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? `Sync finished: ${j.sent} sent, ${j.failed} failed, ${j.skipped} skipped.` : j.error || "Sync failed.");
    await load();
  }
  async function runTest(target: "excel" | "email") {
    setTesting(target);
    const r = await fetch("/api/automation/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target }) });
    const j = await r.json().catch(() => ({}));
    setTesting(""); setTestNote((n) => ({ ...n, [target]: { ok: !!j.ok, text: j.hint || j.error || "No answer." } }));
  }
  async function sendSelected() {
    const ids = sendable.filter((c) => picked.has(c.id)).map((c) => c.id);
    if (!ids.length || !window.confirm(`Send ${ids.length} supplier e-mail(s) one by one?`)) return;
    setRunning(true); setMsg("");
    setResults(Object.fromEntries(ids.map((id) => [id, { id, state: "wait" } as Result])));
    for (const id of ids) { // strictly sequential: the next e-mail starts only after the previous one was answered
      setResults((r) => ({ ...r, [id]: { id, state: "sending" } }));
      try {
        const res = await fetch("/api/automation/followups/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: id }) });
        const j = await res.json().catch(() => ({}));
        const state = j.status === "SENT" ? "SENT" : j.status === "SKIPPED" ? "SKIPPED" : "FAILED";
        setResults((r) => ({ ...r, [id]: { id, state, note: j.error || j.note } }));
        if (j.status === "NOT_CONFIGURED") { setMsg(j.error); break; }
      } catch { setResults((r) => ({ ...r, [id]: { id, state: "FAILED", note: "Network error" } })); }
    }
    setRunning(false); setPicked(new Set()); await load();
  }

  const pending = (k: string) => (status?.counts[`${k}:PENDING`] || 0) + (status?.counts[`${k}:FAILED`] || 0) + (status?.counts[`${k}:SENDING`] || 0);
  return <section className="simple-card" id="automation" style={{ marginBottom: 13 }}>
    <div className="simple-card-head"><div><h2>Power Automate</h2><p>Excel master updates and supplier e-mail</p></div>
      <button className="btn" type="button" onClick={() => void syncNow(false)}><RefreshCw size={13}/> Sync now</button></div>

    <ul style={{ listStyle: "none", margin: "0 0 10px", padding: 0 }}>
      <Step ok={!!status?.configured.excel} label="Excel master flow" detail={status?.configured.excel ? "Connected " + (TRANSPORT[status.transport?.excel || ""] || "") : "Set POWER_AUTOMATE_EXCEL_URL (or the FLOW_SMTP_* mailbox settings) in Vercel, then redeploy"}
        action={status?.configured.excel && <button className="btn btn-sm" type="button" disabled={testing === "excel"} onClick={() => void runTest("excel")}>{testing === "excel" ? "Testing…" : "Test"}</button>}/>
      {testNote.excel && <li role="status" style={{ fontSize: 12, marginLeft: 26, color: testNote.excel.ok ? "#166534" : "#b42336" }}>{testNote.excel.text}</li>}
      <Step ok={!!status?.configured.email} label="Supplier e-mail flow" detail={status?.configured.email ? "Connected " + (TRANSPORT[status.transport?.email || ""] || "") : "Set POWER_AUTOMATE_EMAIL_URL (or the FLOW_SMTP_* mailbox settings) in Vercel"}
        action={status?.configured.email && <button className="btn btn-sm" type="button" disabled={testing === "email"} onClick={() => void runTest("email")}>{testing === "email" ? "Sending…" : "Send test to me"}</button>}/>
      {testNote.email && <li role="status" style={{ fontSize: 12, marginLeft: 26, color: testNote.email.ok ? "#166534" : "#b42336" }}>{testNote.email.text}</li>}
      <Step ok={!!status?.configured.secret} label="Shared secret" detail={status?.configured.secret ? "Set" : "Set POWER_AUTOMATE_SECRET so the flow only accepts this app"}/>
    </ul>

    {status && (pending("EXCEL_UPSERT") > 0 || pending("SUPPLIER_EMAIL") > 0) && <div className="callout callout-info" style={{ marginBottom: 10 }}>
      Waiting: Excel {pending("EXCEL_UPSERT")} · e-mail {pending("SUPPLIER_EMAIL")}. They retry automatically while the app is open.
      {!!status.failed?.length && <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12 }}>{status.failed.map((f) => <li key={f.id}>{f.kind === "EXCEL_UPSERT" ? "Excel" : "E-mail"} · {f.attempts} tries · {f.error || "failed"}</li>)}</ul>}
      {!!status.failed?.length && <button className="btn btn-sm" type="button" style={{ marginTop: 6 }} onClick={() => void syncNow(true)}>Retry failed now</button>}
    </div>}
    {msg && <div className="callout callout-info" style={{ marginBottom: 10 }} role="status">{msg}</div>}

    <h3 style={{ margin: "12px 0 6px", fontSize: 14 }}>Send follow-up e-mails</h3>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
      <input className="field" placeholder="Search part no. or supplier" aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: "2 1 200px" }}/>
      <select className="select-field" aria-label="Error type" value={type} onChange={(e) => setType(e.target.value)} style={{ flex: "1 1 180px" }}>{types.map((t) => <option key={t}>{t}</option>)}</select>
    </div>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
      <label><input type="checkbox" checked={allOn} onChange={() => setPicked((p) => { const n = new Set(p); sendable.forEach((c) => allOn ? n.delete(c.id) : n.add(c.id)); return n; })}/> Select all shown ({sendable.length} ready)</label>
      <button className="btn btn-primary" type="button" disabled={running || !picked.size || !status?.configured.email} onClick={() => void sendSelected()}><Send size={14}/> {running ? `Sending ${doneCount}/${total}…` : `Send ${picked.size} e-mail(s) in order`}</button>
    </div>
    {running && <progress value={doneCount} max={total} style={{ width: "100%", marginBottom: 8 }} aria-label="Sending progress"/>}
    <div className="table-scroll" style={{ maxHeight: 320, overflow: "auto" }}><table><thead><tr><th></th><th>Part no.</th><th>Supplier</th><th>Error type</th><th>Status</th><th></th></tr></thead><tbody>
      {shown.map((c) => { const r = results[c.id]; const ok = c.hasContact && c.followup !== "SENT";
        return <tr key={c.id}><td><input type="checkbox" aria-label={`Select ${c.delivery_part_no}`} disabled={!ok || running} checked={picked.has(c.id)} onChange={() => toggle(c.id)}/></td>
          <td className="mono">{c.delivery_part_no}</td><td className="mono">{c.supplier_code}</td><td>{c.error_type_label}</td>
          <td>{r ? <span title={r.note}>{r.state === "SENT" ? <CheckCircle2 size={13}/> : r.state === "FAILED" ? <AlertTriangle size={13}/> : <Mail size={13}/>} {r.state === "SENT" ? "Handed off" : r.state === "FAILED" ? "Failed" : r.state === "SKIPPED" ? "Skipped" : r.state === "sending" ? "Handing off…" : "Waiting"}{r.note && r.state !== "SENT" ? ` — ${r.note}` : ""}</span> : !c.hasContact ? "No supplier PIC" : c.followup === "SENT" ? "Already handed off" : c.followup ?? "Ready"}</td>
          <td><button className="btn btn-sm" type="button" onClick={() => setPreview(preview === c.id ? null : c.id)}>{preview === c.id ? "Hide" : "Preview"}</button></td></tr>; })}
      {!shown.length && <tr><td colSpan={6}>No matching open records.</td></tr>}
    </tbody></table></div>
    {previewMsg && <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, background: "var(--surface-2)", color: "var(--ink)", border: "1px solid var(--line-strong)", borderRadius: 8, padding: 10, marginTop: 8 }}><strong>{previewMsg.subject}</strong>{"\n\n"}{previewMsg.body}</pre>}

    <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
      <a className="btn btn-sm" href="/api/automation/export" download><Download size={13}/> Download register CSV (one-time Excel seed)</a>
      <span className="muted" style={{ fontSize: 12 }}>Paste it into the Excel table once; later saves update it automatically.</span>
    </div>
    <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>“Handed off” means the flow or mailbox accepted the request. It is not proof that the supplier read it. Confirm in the flow’s Run history.</p>
  </section>;
}
