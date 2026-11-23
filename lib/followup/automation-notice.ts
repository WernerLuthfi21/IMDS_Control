// Sending the reminder to the TMMIN PIC before an automation runs, and the audit summary of a run.
import { postToFlow } from "@/lib/automation/flow";
import { buildSupplierEmailPayload, parseSenders, pickSender } from "./payload";
import { TEAM } from "./render";
import type { Automation } from "./schedule";
import { noticeEmail, type RunResult } from "./scheduled-run";

/** Who gets the reminder: the automation's list, else the sender's own address. */
export const noticeTo = (a: Automation) => (a.notify.to.length ? a.notify.to : [TEAM[a.sender] || Object.values(TEAM)[0]]);

export async function sendNotice(a: Automation, preview: RunResult, runAt: Date, fetchImpl?: typeof fetch): Promise<{ ok: boolean; to: string[]; error?: string }> {
  const to = noticeTo(a);
  const url = process.env.POWER_AUTOMATE_EMAIL_URL?.trim(), secret = process.env.POWER_AUTOMATE_SECRET?.trim() || null;
  if (!url || !/^https:\/\//i.test(url) || !secret) return { ok: false, to, error: "Power Automate is not configured." };
  const mail = noticeEmail(a, preview, runAt, process.env.APP_BASE_URL || "");
  const sender = pickSender(parseSenders(process.env.FOLLOWUP_SENDERS), TEAM[a.sender] || "");
  const payload = buildSupplierEmailPayload({ source: "tracker", supplierCode: "", supplierName: "IMDS automation reminder", to, cc: [], sender, subject: mail.subject, body: mail.body, metadata: { partCount: 0, projects: [], items: preview.planned.length } });
  const d = await postToFlow(url, secret, payload, fetchImpl);
  return { ok: d.ok, to, error: d.error };
}

/** What a run did, for audit_events and the "Last runs" list. */
export function summarize(a: Automation, r: RunResult, manual: boolean) {
  return { automation: a.id, name: a.name, slot: r.slot, manual, sent: r.sent, failed: r.failed, skipped: r.skipped, note: r.note || null,
    suppliers: r.planned.map((p) => ({ s: p.supplier, n: p.parts, st: p.status || "PLANNED", e: p.error || p.skip || null })).slice(0, 300) };
}
