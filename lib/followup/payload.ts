// The ONE e-mail contract between this website and Power Automate (Tracker + Judgement). Version 2 is a superset of the
// older payloads ({type,followupId,to,cc,subject,body} and the Tracker's attachments), so flows built earlier keep working.
import { emailsOf } from "./recipients";

export type Attachment = { name: string; contentType: string; contentBytes: string };
export type Sender = { name: string; email: string };

export type SupplierEmailPayload = {
  type: "supplier_email";
  version: 2;
  source: "tracker" | "judgement";
  followupId: string;
  logId: string;
  supplierCode: string;
  supplierName: string;
  from: string;          // allow-listed mailbox, or "" => the flow's own account sends
  senderName: string;
  to: string;            // ";" separated
  cc: string;            // ";" separated
  subject: string;
  body: string;          // plain text
  /** The same text as safe HTML (escaped, line breaks as <br>): map it straight to Outlook's Body, no expression needed. */
  bodyHtml: string;
  attachments: Attachment[];
  metadata: { partCount: number; projects: string[]; items: number };
};

/** Source of truth for the Power Automate trigger schema. docs/POWER_AUTOMATE_ALL_FLOWS.md embeds this; a test keeps them equal. */
export const SUPPLIER_EMAIL_SCHEMA = {
  type: "object",
  properties: {
    type: { type: "string" }, version: { type: "integer" }, source: { type: "string" },
    followupId: { type: "string" }, logId: { type: "string" },
    supplierCode: { type: "string" }, supplierName: { type: "string" },
    from: { type: "string" }, senderName: { type: "string" },
    to: { type: "string" }, cc: { type: "string" }, subject: { type: "string" }, body: { type: "string" }, bodyHtml: { type: "string" },
    attachments: { type: "array", items: { type: "object", properties: { name: { type: "string" }, contentType: { type: "string" }, contentBytes: { type: "string" } } } },
    metadata: { type: "object", properties: { partCount: { type: "integer" }, projects: { type: "array", items: { type: "string" } }, items: { type: "integer" } } }
  }
} as const;

/** Plain text → minimal safe HTML for Outlook: escape, keep line breaks, keep the font simple. */
export function toHtml(text: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt">${esc.replace(/\r\n|\r|\n/g, "<br>")}</div>`;
}

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** FOLLOWUP_SENDERS="IMDS Team <imds@x.co.id>; Budi <budi@x.co.id>" -> allow-list of mailboxes people may send as. */
export function parseSenders(env: string | undefined): Sender[] {
  return String(env ?? "").split(";").map((s) => s.trim()).filter(Boolean).flatMap((s) => {
    const m = s.match(/^(.*?)<\s*([^>\s]+)\s*>$/);
    const email = (m ? m[2] : s).trim().toLowerCase();
    return emailsOf(email).length ? [{ name: (m ? m[1] : "").trim() || email.split("@")[0], email }] : [];
  });
}
/** A requested sender is honoured ONLY if it is on the allow-list; otherwise null (the flow's own account sends). Prevents spoofing. */
export function pickSender(allowed: Sender[], requested?: string | null): Sender | null {
  const want = String(requested ?? "").trim().toLowerCase();
  return want ? allowed.find((s) => s.email === want) ?? null : null;
}

export type PayloadInput = Omit<SupplierEmailPayload, "type" | "version" | "from" | "senderName" | "to" | "cc" | "attachments" | "followupId" | "logId" | "bodyHtml"> & {
  followupId?: string; logId?: string; to: string[]; cc: string[]; sender?: Sender | null; attachments?: Attachment[];
};

export function buildSupplierEmailPayload(i: PayloadInput): SupplierEmailPayload {
  const to = [...new Set(i.to.flatMap(emailsOf))];
  if (!to.length) throw new Error("No valid recipient e-mail. Nothing was prepared.");
  if (!i.subject.trim() || !i.body.trim()) throw new Error("Subject and message are required.");
  const attachments = (i.attachments ?? []).filter((a) => a.contentBytes);
  const bytes = attachments.reduce((n, a) => n + Math.floor((a.contentBytes.length * 3) / 4), 0);
  if (bytes > MAX_ATTACHMENT_BYTES) throw new Error(`Attachments are ${(bytes / 1048576).toFixed(1)} MB; the limit is 10 MB per e-mail.`);
  return {
    type: "supplier_email", version: 2, source: i.source,
    followupId: i.followupId ?? "", logId: i.logId ?? "",
    supplierCode: i.supplierCode, supplierName: i.supplierName,
    from: i.sender?.email ?? "", senderName: i.sender?.name ?? "",
    to: to.join(";"), cc: [...new Set(i.cc.flatMap(emailsOf))].filter((e) => !to.includes(e)).join(";"),
    subject: i.subject.trim().slice(0, 240), body: i.body.trim().slice(0, 30000), bodyHtml: toHtml(i.body.trim().slice(0, 30000)),
    attachments, metadata: i.metadata
  };
}
