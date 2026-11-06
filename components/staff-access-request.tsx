"use client";
import { useState } from "react";
import { LoaderCircle, Send, CheckCircle2 } from "lucide-react";

export function StaffAccessRequest({ requesterEmail }: { requesterEmail: string }) {
  const [form, setForm] = useState({ fullName: "", email: "", department: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    const response = await fetch("/api/access-requests/staff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) setError(data.error || "The request could not be submitted.");
    else { setNotice(data.notification === "NOT_CONFIGURED" ? "Admin email notifications are not configured. The request is saved in the Admin queue." : data.notification === "PARTIAL" ? "The request is saved, but some Admin notifications could not be delivered." : ""); setDone(true); }
    setBusy(false);
  }
  if (done) return <section className="panel"><div className="panel-body access-staff-success"><CheckCircle2 size={24}/><strong>Request submitted to Admin</strong><span>The account remains inactive until the administrator approves the request.</span>{notice && <small>{notice}</small>}<button type="button" className="btn btn-secondary" onClick={() => { setDone(false); setForm({ fullName: "", email: "", department: "", note: "" }); }}>Register another colleague</button></div></section>;
  return <section className="panel">
    <div className="panel-header"><div><div className="panel-title">Register a TMMIN colleague</div><div className="panel-subtitle">Submit an account request for another TMMIN staff member. The Admin team owns the final approval.</div></div></div>
    <div className="panel-body">
      <form className="staff-request-form" onSubmit={submit}>
        <label className="form-field"><span>Colleague full name</span><input className="field" required maxLength={100} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })}/></label>
        <label className="form-field"><span>Colleague work email</span><input className="field" required type="email" maxLength={254} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}/></label>
        <label className="form-field"><span>Department / division</span><input className="field" maxLength={120} value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="TMMIN department"/></label>
        <label className="form-field"><span>Additional note</span><textarea className="field" rows={3} maxLength={1000} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}/></label>
        <div className="staff-request-meta">Submitted by <strong>{requesterEmail}</strong>. The new account starts with viewer access; an Admin may adjust its role after approval.</div>
        {error && <div className="callout callout-danger" role="alert">{error}</div>}
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? <LoaderCircle size={14} className="spin"/> : <Send size={14}/>} Submit for Admin approval</button>
      </form>
    </div>
  </section>;
}
