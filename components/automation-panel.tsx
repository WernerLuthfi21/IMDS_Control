"use client";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Mail, RefreshCw, Send } from "lucide-react";

type Status = { configured: { excel: boolean; email: boolean; secret: boolean }; counts: Record<string, number>; lastError: string | null };
type Cand = { id: string; source_record_key: string; delivery_part_no: string | null; supplier_code: string; error_type_label: string; hasContact: boolean; followup: string | null };
type Result = { id: string; state: "wait" | "sending" | "SENT" | "FAILED" | "SKIPPED"; note?: string };

export function AutomationPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [cands, setCands] = useState<Cand[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, Result>>({});
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState("");
  const load = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([fetch("/api/automation/status"), fetch("/api/automation/candidates")]);
      if (s.ok) setStatus(await s.json());
      if (c.ok) setCands((await c.json()).candidates || []);
    } catch { /* offline preview */ }
  }, []);
  useEffect(() => { const t = setTimeout(() => { void load(); }, 0); return () => clearTimeout(t); }, [load]);

  const sendable = cands.filter((c) => c.hasContact && c.followup !== "SENT");
  const allOn = sendable.length > 0 && sendable.every((c) => picked.has(c.id));
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function syncNow() {
    setMsg("");
    const r = await fetch("/api/automation/dispatch", { method: "POST" });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? `Sync finished: ${j.sent} sent, ${j.failed} failed, ${j.skipped} skipped (flow not configured).` : j.error || "Sync failed.");
    await load();
  }
  async function sendSelected() {
    const ids = sendable.filter((c) => picked.has(c.id)).map((c) => c.id);
    if (!ids.length || !window.confirm(`Send ${ids.length} supplier e-mail(s) one by one through Power Automate?`)) return;
    setRunning(true); setMsg("");
    setResults(Object.fromEntries(ids.map((id) => [id, { id, state: "wait" } as Result])));
    for (const id of ids) { // strictly sequential: next e-mail starts only after the previous flow answered
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
  return <section className="simple-card" style={{ marginBottom: 13 }}>
    <div className="simple-card-head"><div><h2>Power Automate bridge</h2><p>Every judgement saved in the web is queued for the master Excel; supplier e-mails are sent one after another from one click.</p></div><button className="btn" type="button" onClick={syncNow}><RefreshCw size={13} /> Sync now</button></div>
    {status && <div className="callout callout-info" style={{ marginBottom: 10 }}>
      Excel flow: <strong>{status.configured.excel ? "configured" : "NOT configured"}</strong> · E-mail flow: <strong>{status.configured.email ? "configured" : "NOT configured"}</strong> · Waiting to sync: Excel {pending("EXCEL_UPSERT")}, e-mail {pending("SUPPLIER_EMAIL")}
      {status.lastError && <> · last error: {status.lastError}</>}
    </div>}
    {msg && <div className="callout callout-info" style={{ marginBottom: 10 }}>{msg}</div>}
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 8 }}>
      <label><input type="checkbox" checked={allOn} onChange={() => setPicked(allOn ? new Set() : new Set(sendable.map((c) => c.id)))} /> Select all ({sendable.length} ready)</label>
      <button className="btn btn-primary" type="button" disabled={running || !picked.size} onClick={sendSelected}><Send size={14} /> {running ? "Sending…" : `Send ${picked.size} e-mail(s) in order`}</button>
    </div>
    <div className="table-scroll" style={{ maxHeight: 320, overflow: "auto" }}><table><thead><tr><th></th><th>Part no.</th><th>Supplier</th><th>Error type</th><th>Status</th></tr></thead><tbody>
      {cands.map((c) => { const r = results[c.id]; const ok = c.hasContact && c.followup !== "SENT";
        return <tr key={c.id}><td><input type="checkbox" aria-label={`Select ${c.delivery_part_no}`} disabled={!ok || running} checked={picked.has(c.id)} onChange={() => toggle(c.id)} /></td>
          <td className="mono">{c.delivery_part_no}</td><td className="mono">{c.supplier_code}</td><td>{c.error_type_label}</td>
          <td>{r ? <span title={r.note}>{r.state === "SENT" ? <CheckCircle2 size={13} /> : r.state === "FAILED" ? <AlertTriangle size={13} /> : <Mail size={13} />} {r.state}{r.note && r.state !== "SENT" ? ` — ${r.note}` : ""}</span> : !c.hasContact ? "No supplier PIC" : c.followup === "SENT" ? "Already sent" : c.followup ?? "Ready"}</td></tr>; })}
      {!cands.length && <tr><td colSpan={5}>No open WORKING records with a supplier code.</td></tr>}
    </tbody></table></div>
    <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>“SENT” means the flow accepted the request (HTTP 2xx). It does not prove the supplier received or read it. The Excel master is updated by the flow, not by this app directly.</p>
  </section>;
}
