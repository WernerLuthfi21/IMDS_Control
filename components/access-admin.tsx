"use client";
import { useState } from "react";
import { Bell, Check, LoaderCircle, Trash2, UserPlus, X } from "lucide-react";

export type AccessRequest = { id: string; kind: string; via: string; full_name: string; company: string | null; supplier_code: string | null; email: string; requested_role: string | null; status: string; contact_matched: boolean; created_at: string; decided_at: string | null; granted_role: string | null; notification_status: string | null };
export type Recipient = { id: string; email: string; display_name: string | null; active: boolean };
const TMMIN_ROLES = ["viewer", "preparer", "reviewer", "rule_author", "rule_approver", "admin"];
const KIND: Record<string, string> = { supplier: "Supplier", tmmin: "TMMIN staff", password_help: "Password help" };

async function call(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, j };
}

function Row({ r, onDone }: { r: AccessRequest; onDone: (id: string, status: string) => void }) {
  const [role, setRole] = useState(r.kind === "supplier" ? "supplier" : r.requested_role || "viewer");
  const [code, setCode] = useState(r.supplier_code || "");
  const [busy, setBusy] = useState(""); const [msg, setMsg] = useState("");
  async function decide(action: "approve" | "reject") {
    setBusy(action); setMsg("");
    const { ok, j } = await call("/api/admin/access/" + r.id, "POST", { action, role, supplierCode: code });
    setBusy("");
    if (!ok) { setMsg(j.error || "Failed."); return; }
    onDone(r.id, j.status);
  }
  return <tr>
    <td><strong>{r.full_name}</strong><small className="ta-self"> {KIND[r.kind]}{r.via === "STAFF" ? " · by staff" : ""}</small><div className="mono" style={{ fontSize: 12 }}>{r.email}</div></td>
    <td>{r.company || "—"}{r.kind === "supplier" && <div>{r.contact_matched ? <span className="state-pill state-ready">contact on file</span> : <span className="state-pill state-pending">email not in contacts</span>}</div>}</td>
    <td>{r.kind === "supplier" ? <input className="field" aria-label="Supplier code" value={code} maxLength={20} onChange={(e) => setCode(e.target.value.toUpperCase())}/> : r.kind === "tmmin" ? <select className="select-field" aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)}>{TMMIN_ROLES.map((x) => <option key={x}>{x}</option>)}</select> : "—"}</td>
    <td className="ta-act">
      <button type="button" className="btn btn-sm btn-primary" disabled={!!busy} onClick={() => void decide("approve")}>{busy === "approve" ? <LoaderCircle size={13} className="spin"/> : <Check size={13}/>} {r.kind === "password_help" ? "Send reset" : "Approve"}</button>{" "}
      <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => void decide("reject")}><X size={13}/> Reject</button>
      {msg && <small className="ta-err" role="alert">{msg}</small>}
    </td>
  </tr>;
}

export function AccessQueue({ initial, recent }: { initial: AccessRequest[]; recent: AccessRequest[] }) {
  const [pending, setPending] = useState(initial);
  const [decided, setDecided] = useState(recent);
  return <section className="panel" id="access" style={{ marginTop: 16 }}>
    <div className="panel-header"><div><div className="panel-title">Access requests</div></div><span className="quiet-badge">{pending.length} PENDING</span></div>
    <div className="panel-body">
      {pending.length ? <div className="table-scroll"><table><thead><tr><th>Requester</th><th>Company</th><th>Grant</th><th></th></tr></thead><tbody>
        {pending.map((r) => <Row key={r.id} r={r} onDone={(id, status) => { setPending((p) => p.filter((x) => x.id !== id)); setDecided((d) => [{ ...r, status }, ...d].slice(0, 10)); }}/>)}
      </tbody></table></div> : <div className="empty-note">No requests waiting.</div>}
      {decided.length > 0 && <details style={{ marginTop: 12 }}><summary>Recently decided ({decided.length})</summary>
        <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12 }}>{decided.map((r) => <li key={r.id}>{r.full_name} · {r.email} · {KIND[r.kind]} · <strong>{r.status}</strong>{r.granted_role ? " · " + r.granted_role : ""}</li>)}</ul></details>}
    </div>
  </section>;
}

export function RecipientsPanel({ initial }: { initial: Recipient[] }) {
  const [list, setList] = useState(initial);
  const [email, setEmail] = useState(""); const [name, setName] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  async function add(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    const { ok, j } = await call("/api/admin/access/recipients", "POST", { email, name });
    setBusy(false);
    if (!ok) { setErr(j.error || "Failed."); return; }
    setList((l) => [...l, j.recipient]); setEmail(""); setName("");
  }
  async function toggle(r: Recipient) {
    const { ok } = await call("/api/admin/access/recipients", "PATCH", { id: r.id, active: !r.active });
    if (ok) setList((l) => l.map((x) => x.id === r.id ? { ...x, active: !x.active } : x));
  }
  async function remove(r: Recipient) {
    const { ok } = await call("/api/admin/access/recipients?id=" + r.id, "DELETE");
    if (ok) setList((l) => l.filter((x) => x.id !== r.id));
  }
  return <section className="panel" style={{ marginTop: 16 }}>
    <div className="panel-header"><div><div className="panel-title">Approval PIC</div><div className="panel-subtitle">Receive an email for each new request</div></div><Bell size={16}/></div>
    <div className="panel-body">
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
        {list.map((r) => <li key={r.id} style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center", flex: 1 }}><input type="checkbox" checked={r.active} onChange={() => void toggle(r)}/> <span>{r.display_name ? r.display_name + " · " : ""}{r.email}</span></label>
          <button type="button" className="btn btn-sm" aria-label={"Remove " + r.email} onClick={() => void remove(r)}><Trash2 size={13}/></button></li>)}
        {!list.length && <li className="empty-note">No PIC set: all admins are notified.</li>}
      </ul>
      <form onSubmit={add} style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <input className="field" placeholder="Name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} style={{ flex: "1 1 140px" }}/>
        <input className="field" type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ flex: "2 1 220px" }}/>
        <button className="btn btn-primary" disabled={busy}>{busy ? <LoaderCircle size={13} className="spin"/> : <UserPlus size={13}/>} Add</button>
      </form>
      {err && <small className="ta-err" role="alert">{err}</small>}
    </div>
  </section>;
}
