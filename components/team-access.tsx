"use client";
import { useState } from "react";
import { Check, LoaderCircle, Users } from "lucide-react";

export type Member = { id: string; email: string | null; display_name: string | null; role: string; supplier_code: string | null };
const ROLES = ["admin", "preparer", "reviewer", "viewer", "supplier", "rule_author", "rule_approver"];

function MemberRow({ m, self }: { m: Member; self: boolean }) {
  const [saved, setSaved] = useState({ name: m.display_name || "", code: m.supplier_code || "", role: m.role });
  const [name, setName] = useState(m.display_name || "");
  const [code, setCode] = useState(m.supplier_code || "");
  const [role, setRole] = useState(m.role);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [msg, setMsg] = useState("");
  const dirty = name !== saved.name || code !== saved.code || role !== saved.role;
  async function save() {
    setState("saving"); setMsg("");
    const r = await fetch("/api/admin/profiles/" + m.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ display_name: name, supplier_code: code, role }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setState("error"); setMsg(j.error || "Could not save."); return; }
    setSaved({ name: j.profile.display_name || "", code: j.profile.supplier_code || "", role: j.profile.role });
    setName(j.profile.display_name || ""); setCode(j.profile.supplier_code || ""); setRole(j.profile.role);
    setState("saved");
  }
  return <tr>
    <td><strong>{m.email || "—"}</strong>{self && <small className="ta-self"> you</small>}</td>
    <td><input className="field" aria-label={"Display name for " + m.email} value={name} maxLength={60} placeholder="Display name" onChange={(e) => { setName(e.target.value); setState("idle"); }}/></td>
    <td><select className="select-field" aria-label="Role" value={role} disabled={self} onChange={(e) => { setRole(e.target.value); setState("idle"); }}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></td>
    <td><input className="field" aria-label="Supplier code" value={code} maxLength={20} disabled={role !== "supplier"} placeholder={role === "supplier" ? "Supplier code" : "—"} onChange={(e) => { setCode(e.target.value); setState("idle"); }}/></td>
    <td className="ta-act"><button type="button" className="btn btn-sm btn-primary" disabled={!dirty || state === "saving"} onClick={() => void save()}>{state === "saving" ? <LoaderCircle size={13} className="spin"/> : state === "saved" && !dirty ? <Check size={13}/> : null} Save</button>{state === "error" && <small className="ta-err" role="alert">{msg}</small>}</td>
  </tr>;
}

export function TeamAccess({ members, selfId }: { members: Member[]; selfId: string }) {
  return <section className="panel" style={{ marginTop: 14 }}>
    <div className="panel-header"><div><div className="panel-title">Team &amp; access</div><div className="panel-subtitle">Set the display name shown as “Assigned person” (the sign-in email stays unchanged). Supplier accounts need role supplier and a supplier code.</div></div><Users size={16}/></div>
    <div className="panel-body"><div className="table-scroll"><table className="ta-table"><thead><tr><th>Sign-in</th><th>Display name</th><th>Role</th><th>Supplier code</th><th/></tr></thead>
      <tbody>{members.map((m) => <MemberRow key={m.id} m={m} self={m.id === selfId}/>)}</tbody></table></div></div>
  </section>;
}
