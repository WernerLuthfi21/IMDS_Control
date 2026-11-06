"use client";
import { useState } from "react";
import { Check, Clock3, LoaderCircle, MailPlus, ShieldCheck, UserRoundCheck, X, Trash2 } from "lucide-react";

type AccessRequest = {
  id: string; request_type: "SUPPLIER" | "TMMIN_STAFF"; requester_name: string; requester_email: string;
  company_name: string; target_name: string; target_email: string; requested_role: string;
  supplier_code: string | null; note: string | null; status: string; created_at: string;
};
type Recipient = { id: string; email: string; display_name: string | null; active: boolean };

export function AccessManagement({ initialRequests, initialRecipients }: { initialRequests: AccessRequest[]; initialRecipients: Recipient[] }) {
  const [requests, setRequests] = useState(initialRequests);
  const [recipients, setRecipients] = useState(initialRecipients);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function review(id: string, action: "approve" | "reject") {
    setBusy(id); setError(""); setMessage("");
    const response = await fetch("/api/admin/access-requests/" + id, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setError(data.error || "The request could not be processed."); setBusy(""); return; }
    setRequests((items) => items.map((item) => item.id === id ? { ...item, status: action === "approve" ? "APPROVED" : "REJECTED" } : item));
    setMessage(action === "approve" ? (data.inviteSent ? "Request approved. The account invitation email has been issued." : "Request approved. The existing account role has been updated.") : "Request rejected.");
    setBusy("");
  }

  async function addRecipient(e: React.FormEvent) {
    e.preventDefault(); setBusy("recipient"); setError(""); setMessage("");
    const response = await fetch("/api/admin/access-recipients", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, displayName })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setError(data.error || "Could not add the approver."); setBusy(""); return; }
    setRecipients((items) => [data.recipient, ...items.filter((x) => x.id !== data.recipient.id)]);
    setEmail(""); setDisplayName(""); setMessage("Approval notification recipient saved."); setBusy("");
  }

  async function removeRecipient(id: string) {
    setBusy(id); setError(""); setMessage("");
    const response = await fetch("/api/admin/access-recipients?id=" + encodeURIComponent(id), { method: "DELETE" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setError(data.error || "Could not remove this recipient."); setBusy(""); return; }
    setRecipients((items) => items.filter((item) => item.id !== id)); setMessage("Notification recipient removed."); setBusy("");
  }

  const pending = requests.filter((item) => item.status === "PENDING");
  return <div className="access-admin-stack">
    <section className="panel">
      <div className="panel-header"><div><div className="panel-title">Access approval queue</div><div className="panel-subtitle">All supplier and TMMIN staff requests are reviewed here by an administrator.</div></div><span className="status status-amber">{pending.length} PENDING</span></div>
      <div className="panel-body">
        {error && <div className="callout callout-danger" role="alert">{error}</div>}
        {message && <div className="callout callout-success" role="status">{message}</div>}
        {pending.length === 0 ? <div className="access-empty"><Check size={20}/><strong>No pending requests</strong><span>New requests will appear in this queue.</span></div> :
          <div className="access-request-list">{pending.map((item) => <article className="access-request-card" key={item.id}>
            <div className="access-request-top">
              <div><span className={"access-kind " + (item.request_type === "SUPPLIER" ? "supplier" : "staff")}>{item.request_type === "SUPPLIER" ? "SUPPLIER" : "TMMIN STAFF"}</span><h3>{item.target_name}</h3><a href={"mailto:" + item.target_email}>{item.target_email}</a></div>
              <time>{new Date(item.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</time>
            </div>
            <div className="access-request-meta"><span><b>Company</b>{item.company_name}</span>{item.supplier_code && <span><b>Supplier code</b>{item.supplier_code}</span>}<span><b>Requested role</b>{item.requested_role}</span></div>
            {item.request_type === "TMMIN_STAFF" && <p className="access-request-by">Requested by {item.requester_name} · {item.requester_email}</p>}
            {item.note && <p className="access-request-note">{item.note}</p>}
            <div className="access-request-actions">
              <button type="button" className="btn btn-sm btn-primary" disabled={busy === item.id} onClick={() => void review(item.id, "approve")}>{busy === item.id ? <LoaderCircle size={14} className="spin"/> : <UserRoundCheck size={14}/>} Approve &amp; invite</button>
              <button type="button" className="btn btn-sm btn-secondary" disabled={busy === item.id} onClick={() => void review(item.id, "reject")}><X size={14}/> Reject</button>
            </div>
          </article>)}</div>}
        {requests.some((item) => item.status !== "PENDING") && <details className="access-history"><summary>Previously reviewed ({requests.filter((item) => item.status !== "PENDING").length})</summary><div>{requests.filter((item) => item.status !== "PENDING").slice(0, 30).map((item) => <div className="access-history-row" key={item.id}><span>{item.target_name} · {item.target_email}</span><span className={item.status === "APPROVED" ? "access-approved" : "access-rejected"}>{item.status}</span></div>)}</div></details>}
      </div>
    </section>

    <section className="panel">
      <div className="panel-header"><div><div className="panel-title">Approval notification owners</div><div className="panel-subtitle">Set the people who receive access-request approval emails. Keep at least one active owner.</div></div><ShieldCheck size={17}/></div>
      <div className="panel-body">
        <form className="access-recipient-form" onSubmit={addRecipient}>
          <label className="form-field"><span>Person in charge</span><input className="field" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Name (optional)" maxLength={100}/></label>
          <label className="form-field"><span>Approval email</span><input className="field" required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com"/></label>
          <button type="submit" className="btn btn-primary" disabled={busy === "recipient"}>{busy === "recipient" ? <LoaderCircle size={14} className="spin"/> : <MailPlus size={14}/>} Add PIC</button>
        </form>
        <div className="access-recipient-list">{recipients.map((recipient) => <div className="access-recipient" key={recipient.id}>
          <div><strong>{recipient.display_name || recipient.email}</strong>{recipient.display_name && <span>{recipient.email}</span>}</div>
          <span className="status status-green">ACTIVE</span>
          <button type="button" className="icon-button" aria-label={"Remove " + recipient.email} title="Remove recipient" disabled={busy === recipient.id} onClick={() => void removeRecipient(recipient.id)}><Trash2 size={15}/></button>
        </div>)}
        {recipients.length === 0 && <p className="access-muted">No PIC has been configured yet. Add at least one email address so new requests can trigger an approval notification.</p>}</div>
      </div>
    </section>
  </div>;
}
