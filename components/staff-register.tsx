"use client";
import { useState } from "react";
import { LoaderCircle, UserPlus } from "lucide-react";

const ROLES = ["viewer", "preparer", "reviewer"];
export function StaffRegister() {
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [role, setRole] = useState("viewer");
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    const r = await fetch("/api/access/staff-request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, email, role }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, text: j.error || "Could not submit." }); return; }
    setMsg({ ok: true, text: "Sent to an admin for approval." }); setName(""); setEmail("");
  }
  return <section className="panel" style={{ marginTop: 16 }}>
    <div className="panel-header"><div><div className="panel-title">Register TMMIN staff</div></div><UserPlus size={16}/></div>
    <div className="panel-body"><form onSubmit={submit} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <input className="field" required placeholder="Full name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} style={{ flex: "1 1 160px" }}/>
      <input className="field" type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ flex: "2 1 220px" }}/>
      <select className="select-field" aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
      <button className="btn btn-primary" disabled={busy}>{busy ? <LoaderCircle size={13} className="spin"/> : null} Submit</button>
    </form>{msg && <small className={msg.ok ? "" : "ta-err"} role="status">{msg.text}</small>}</div>
  </section>;
}
