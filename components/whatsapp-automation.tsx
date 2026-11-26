"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, MessageCircle, RefreshCw, Send, ShieldCheck, Users, Zap } from "lucide-react";

type Sender = { key: string; label: string; displayPhoneNumber: string };
type Template = { name: string; language: string; category?: string; status: string };
type Contact = {
  id: string; supplier_code: string; supplier_name: string | null; contact_name: string | null;
  email: string; whatsapp_phone_e164: string | null; whatsapp_opt_in: boolean;
  whatsapp_opt_in_at: string | null; whatsapp_opt_out_at: string | null;
};
type Campaign = {
  id: string; name: string; sender_key: string; sender_label: string; sender_phone: string;
  template_name: string; template_language: string; mode: "automatic" | "semi_automatic";
  status: string; total_count: number; created_at: string; approved_at: string | null;
  counts: Record<string, number>;
};

const statusLabel: Record<string, string> = {
  AWAITING_APPROVAL: "Awaiting approval",
  QUEUED: "Queued",
  RUNNING: "Running",
  COMPLETED: "Completed",
  PARTIAL: "Partially completed",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

function acceptedCount(campaign: Campaign) {
  return (campaign.counts.SENT || 0) + (campaign.counts.DELIVERED || 0) + (campaign.counts.READ || 0);
}
function pendingCount(campaign: Campaign) {
  return (campaign.counts.PENDING || 0) + (campaign.counts.SENDING || 0) + (campaign.counts.AWAITING_APPROVAL || 0);
}

export function WhatsAppAutomation() {
  const [tab, setTab] = useState<"campaign" | "contacts">("campaign");
  const [senders, setSenders] = useState<Sender[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [eligibleCount, setEligibleCount] = useState(0);
  const [senderKey, setSenderKey] = useState("");
  const [templateChoice, setTemplateChoice] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [parametersText, setParametersText] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [mode, setMode] = useState<"automatic" | "semi_automatic">("automatic");
  const [contactSearch, setContactSearch] = useState("");
  const [contactEdits, setContactEdits] = useState<Record<string, { phone: string; optIn: boolean }>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selectedTemplate = useMemo(() => {
    const [name, language] = templateChoice.split("|");
    return templates.find((item) => item.name === name && item.language === language) || null;
  }, [templateChoice, templates]);

  const loadCampaigns = useCallback(async () => {
    try {
      const response = await fetch("/api/whatsapp/campaigns", { cache: "no-store" });
      const json = await response.json();
      if (response.ok) setCampaigns(json.campaigns || []);
    } catch {
      // The next refresh can recover from a temporary network error.
    }
  }, []);

  const loadContacts = useCallback(async () => {
    const response = await fetch("/api/whatsapp/contacts", { cache: "no-store" });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || "Could not load supplier contacts.");
    const rows = (json.contacts || []) as Contact[];
    setContacts(rows);
    setEligibleCount(Number(json.eligibleCount || 0));
    setContactEdits(Object.fromEntries(rows.map((contact) => [contact.id, {
      phone: contact.whatsapp_phone_e164 || "",
      optIn: !!contact.whatsapp_opt_in,
    }])));
  }, []);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const senderResponse = await fetch("/api/whatsapp/senders", { cache: "no-store" });
      const senderJson = await senderResponse.json();
      if (senderResponse.ok) {
        const values = (senderJson.senders || []) as Sender[];
        setSenders(values);
        if (values.length) setSenderKey((current) => current || values[0].key);
      } else {
        setError(senderJson.error || "WhatsApp senders are not configured.");
      }
      await Promise.all([loadContacts(), loadCampaigns()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load WhatsApp settings.");
    } finally {
      setLoading(false);
    }
  }, [loadCampaigns, loadContacts]);

  useEffect(() => {
    void loadInitial();
    const timer = window.setInterval(() => { void loadCampaigns(); }, 10000);
    return () => window.clearInterval(timer);
  }, [loadCampaigns, loadInitial]);

  useEffect(() => {
    if (!senderKey) { setTemplates([]); setTemplateChoice(""); return; }
    let active = true;
    setTemplateLoading(true);
    setTemplateChoice("");
    fetch("/api/whatsapp/templates?senderKey=" + encodeURIComponent(senderKey), { cache: "no-store" })
      .then(async (response) => {
        const json = await response.json();
        if (!response.ok) throw new Error(json.error || "Could not load approved templates.");
        if (active) setTemplates((json.templates || []) as Template[]);
      })
      .catch((e: unknown) => {
        if (active) {
          setTemplates([]);
          setError(e instanceof Error ? e.message : "Could not load approved templates.");
        }
      })
      .finally(() => { if (active) setTemplateLoading(false); });
    return () => { active = false; };
  }, [senderKey]);

  async function createCampaign(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTemplate) { setError("Choose an approved Meta template first."); return; }
    setSaving(true); setError(""); setNotice("");
    try {
      const bodyParameters = parametersText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const response = await fetch("/api/whatsapp/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: campaignName,
          senderKey,
          templateName: selectedTemplate.name,
          templateLanguage: selectedTemplate.language,
          bodyParameters,
          supplierCode: supplierFilter.trim() || undefined,
          mode,
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Could not create campaign.");
      if (mode === "automatic") {
        const dispatchResponse = await fetch("/api/whatsapp/dispatch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ campaignId: json.campaign.id, limit: 10 }),
        });
        const dispatchJson = await dispatchResponse.json();
        if (!dispatchResponse.ok) throw new Error(dispatchJson.error || "Campaign queued, but first dispatch failed. The scheduled worker may still process it.");
        setNotice("Campaign queued for " + json.recipientCount + " eligible contacts. First batch accepted by Meta: " + (dispatchJson.accepted || 0) + "; failed: " + (dispatchJson.failed || 0) + ". The scheduled worker continues the queue.");
      } else {
        setNotice("Campaign created for " + json.recipientCount + " eligible contacts. It will not send until an admin or preparer approves it.");
      }
      setCampaignName("");
      setParametersText("");
      await loadCampaigns();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Campaign creation failed.");
    } finally {
      setSaving(false);
    }
  }

  async function campaignAction(id: string, action: "approve" | "retry" | "dispatch") {
    setSaving(true); setError(""); setNotice("");
    try {
      const endpoint = action === "dispatch"
        ? "/api/whatsapp/dispatch"
        : "/api/whatsapp/campaigns/" + encodeURIComponent(id) + "/" + action;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "dispatch" ? { campaignId: id, limit: 20 } : {}),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Campaign action failed.");
      if (action === "approve" || action === "retry") {
        const sent = await fetch("/api/whatsapp/dispatch", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ campaignId: id, limit: 20 }),
        });
        const sentJson = await sent.json();
        if (!sent.ok) throw new Error(sentJson.error || "Action saved, but first dispatch failed.");
        setNotice((action === "approve" ? "Campaign approved." : "Eligible failed messages requeued.") + " First batch accepted by Meta: " + (sentJson.accepted || 0) + ".");
      } else {
        setNotice("Queue processing complete for this batch. Accepted: " + (json.accepted || 0) + "; failed: " + (json.failed || 0) + ".");
      }
      await loadCampaigns();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Campaign action failed.");
    } finally {
      setSaving(false);
    }
  }

  async function saveContact(contact: Contact) {
    const edit = contactEdits[contact.id];
    if (!edit) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/whatsapp/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId: contact.id,
          phoneE164: edit.phone,
          optIn: edit.optIn,
          consentSource: "IMDS Control Center admin confirmation",
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Could not save WhatsApp contact.");
      setNotice("WhatsApp contact saved for " + contact.supplier_code + ".");
      await loadContacts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save WhatsApp contact.");
    } finally {
      setSaving(false);
    }
  }

  const visibleContacts = contacts.filter((contact) => {
    const q = contactSearch.trim().toLowerCase();
    return !q || [contact.supplier_code, contact.supplier_name, contact.contact_name, contact.email]
      .some((value) => String(value || "").toLowerCase().includes(q));
  });
  const configured = senders.length > 0;

  return (
    <div className="followup-page">
      {error && <div className="callout callout-danger" role="alert"><AlertTriangle size={15}/>{error}</div>}
      {notice && <div className="callout callout-success" role="status"><CheckCircle2 size={15}/>{notice}</div>}

      <div className="section-tabs" role="tablist" aria-label="WhatsApp sections">
        <button type="button" className={"btn " + (tab === "campaign" ? "btn-primary" : "")} onClick={() => setTab("campaign")}>Campaign manager</button>
        <button type="button" className={"btn " + (tab === "contacts" ? "btn-primary" : "")} onClick={() => setTab("contacts")}>Supplier WhatsApp contacts</button>
      </div>

      {tab === "campaign" ? (
        <>
          <div className="stats-grid">
            <div className="simple-card"><div className="stat-label"><Users size={14}/> Eligible recipients</div><div className="stat-value">{eligibleCount.toLocaleString("en-US")}</div></div>
            <div className="simple-card"><div className="stat-label"><MessageCircle size={14}/> Configured senders</div><div className="stat-value">{senders.length}</div></div>
            <div className="simple-card"><div className="stat-label"><Clock3 size={14}/> Active campaigns</div><div className="stat-value">{campaigns.filter((campaign) => ["QUEUED", "RUNNING", "AWAITING_APPROVAL"].includes(campaign.status)).length}</div></div>
          </div>

          {!configured && !loading && (
            <div className="callout callout-info">
              No WhatsApp sender is configured yet. Add WHATSAPP_SENDERS_JSON to Vercel server-side Environment Variables, then redeploy. See docs/WHATSAPP_SETUP_ID.md.
            </div>
          )}

          <section className="simple-card">
            <div className="simple-card-head">
              <div><h2>Create WhatsApp campaign</h2><p>Only active supplier contacts with a valid phone number and recorded WhatsApp opt-in are included.</p></div>
              <Zap size={18}/>
            </div>
            <form onSubmit={createCampaign}>
              <div className="form-grid">
                <div className="form-field">
                  <label htmlFor="wa-campaign-name">Campaign name</label>
                  <input id="wa-campaign-name" className="field" value={campaignName} onChange={(event) => setCampaignName(event.target.value)} required maxLength={120} placeholder="Supplier status reminder"/>
                </div>
                <div className="form-field">
                  <label htmlFor="wa-sender">WhatsApp sender</label>
                  <select id="wa-sender" className="select-field" value={senderKey} onChange={(event) => setSenderKey(event.target.value)} required disabled={!configured}>
                    {senders.map((sender) => <option key={sender.key} value={sender.key}>{sender.label} · {sender.displayPhoneNumber}</option>)}
                  </select>
                </div>
                <div className="form-field">
                  <label htmlFor="wa-template">Approved Meta template</label>
                  <select id="wa-template" className="select-field" value={templateChoice} onChange={(event) => setTemplateChoice(event.target.value)} required disabled={templateLoading || !templates.length}>
                    <option value="">{templateLoading ? "Loading templates…" : "Choose approved template…"}</option>
                    {templates.map((template) => <option key={template.name + "|" + template.language} value={template.name + "|" + template.language}>{template.name} · {template.language}{template.category ? " · " + template.category : ""}</option>)}
                  </select>
                </div>
                <div className="form-field">
                  <label htmlFor="wa-supplier-filter">Supplier code filter (optional)</label>
                  <input id="wa-supplier-filter" className="field" value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)} placeholder="Leave blank for all opted-in contacts"/>
                </div>
                <div className="form-field">
                  <label htmlFor="wa-mode">Sending mode</label>
                  <select id="wa-mode" className="select-field" value={mode} onChange={(event) => setMode(event.target.value as "automatic" | "semi_automatic")}>
                    <option value="automatic">Automatic — start queue after create</option>
                    <option value="semi_automatic">Semi-automatic — require approval</option>
                  </select>
                </div>
                <div className="form-field">
                  <label htmlFor="wa-parameters">Template body parameters (one per line)</label>
                  <textarea id="wa-parameters" className="textarea-field" rows={4} value={parametersText} onChange={(event) => setParametersText(event.target.value)} placeholder={"{{contact_name}}\n{{supplier_name}}\n{{supplier_code}}"} />
                  <small>Line 1 maps to template {"{{1}}"}, line 2 to {"{{2}}"}, etc. Supported contact tokens: {"{{contact_name}}"}, {"{{supplier_name}}"}, {"{{supplier_code}}"}.</small>
                </div>
              </div>
              <div className="callout callout-info" style={{ marginTop: 12 }}>
                <ShieldCheck size={15}/> {eligibleCount.toLocaleString("en-US")} opted-in contacts are currently eligible. A campaign can include up to 1,000 contacts per run.
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
                <button className="btn btn-primary" type="submit" disabled={saving || loading || !configured || !selectedTemplate}>
                  {saving ? "Preparing campaign…" : mode === "automatic" ? <><Send size={14}/> Create & start campaign</> : <><ShieldCheck size={14}/> Create for approval</>}
                </button>
              </div>
            </form>
          </section>

          <section className="simple-card">
            <div className="simple-card-head">
              <div><h2>Campaign history</h2><p>Meta acceptance and delivery receipts are shown separately.</p></div>
              <button className="btn" type="button" onClick={() => void loadCampaigns()}><RefreshCw size={14}/> Refresh</button>
            </div>
            {campaigns.length === 0 ? <p className="empty-state">No WhatsApp campaigns yet.</p> : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>Campaign</th><th>Sender</th><th>Mode / Status</th><th>Accepted</th><th>Pending</th><th>Failed</th><th>Action</th></tr></thead>
                  <tbody>
                    {campaigns.map((campaign) => (
                      <tr key={campaign.id}>
                        <td><strong>{campaign.name}</strong><br/><small>{campaign.template_name} · {campaign.template_language} · {campaign.total_count} recipients</small></td>
                        <td>{campaign.sender_label}<br/><small>{campaign.sender_phone}</small></td>
                        <td>{campaign.mode === "automatic" ? "Automatic" : "Semi-automatic"}<br/><span className="quiet-badge">{statusLabel[campaign.status] || campaign.status}</span></td>
                        <td>{acceptedCount(campaign)}</td>
                        <td>{pendingCount(campaign)}</td>
                        <td>{campaign.counts.FAILED || 0}</td>
                        <td>
                          <div className="table-actions">
                            {campaign.status === "AWAITING_APPROVAL" && <button className="btn btn-primary" type="button" disabled={saving} onClick={() => void campaignAction(campaign.id, "approve")}>Approve & send</button>}
                            {["QUEUED", "RUNNING"].includes(campaign.status) && <button className="btn" type="button" disabled={saving} onClick={() => void campaignAction(campaign.id, "dispatch")}>Process now</button>}
                            {(campaign.counts.FAILED || 0) > 0 && <button className="btn" type="button" disabled={saving} onClick={() => void campaignAction(campaign.id, "retry")}>Retry failed</button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : (
        <section className="simple-card">
          <div className="simple-card-head">
            <div><h2>Supplier WhatsApp contacts</h2><p>Maintain the WhatsApp number and record explicit consent on the existing supplier directory.</p></div>
            <button className="btn" type="button" onClick={() => void loadContacts()}><RefreshCw size={14}/> Refresh</button>
          </div>
          <div className="form-field" style={{ maxWidth: 420, marginBottom: 14 }}>
            <label htmlFor="wa-contact-search">Search supplier / PIC</label>
            <input id="wa-contact-search" className="field" value={contactSearch} onChange={(event) => setContactSearch(event.target.value)} placeholder="Supplier code, company, PIC or email"/>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Supplier / PIC</th><th>Existing email</th><th>WhatsApp number (E.164)</th><th>Consent</th><th>Action</th></tr></thead>
              <tbody>
                {visibleContacts.slice(0, 150).map((contact) => {
                  const edit = contactEdits[contact.id] || { phone: "", optIn: false };
                  return (
                    <tr key={contact.id}>
                      <td><strong>{contact.supplier_name || contact.supplier_code}</strong><br/><small>{contact.supplier_code} · {contact.contact_name || "No PIC name"}</small></td>
                      <td>{contact.email}</td>
                      <td><input className="field" aria-label={"WhatsApp number for " + contact.supplier_code} value={edit.phone} onChange={(event) => setContactEdits((current) => ({ ...current, [contact.id]: { ...edit, phone: event.target.value } }))} placeholder="+628123456789"/></td>
                      <td><label className="checkbox-row"><input type="checkbox" checked={edit.optIn} onChange={(event) => setContactEdits((current) => ({ ...current, [contact.id]: { ...edit, optIn: event.target.checked } }))}/> Opted in</label></td>
                      <td><button className="btn" type="button" disabled={saving} onClick={() => void saveContact(contact)}>Save</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {visibleContacts.length > 150 && <p className="quiet-note">Showing 150 of {visibleContacts.length} matching contacts. Narrow the search to locate additional contacts.</p>}
          <div className="callout callout-info" style={{ marginTop: 12 }}>
            Only mark a contact as opted in when the business has a documented permission to contact that person on WhatsApp. Unticking consent prevents future campaigns from including that contact.
          </div>
        </section>
      )}
    </div>
  );
}
