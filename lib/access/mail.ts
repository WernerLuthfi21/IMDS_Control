type MailResult = { configured: boolean; sent: number; failed: number };

export async function sendAccessApprovalNotice(recipients: string[], subject: string, text: string): Promise<MailResult> {
  const host = process.env.FLOW_SMTP_HOST?.trim();
  const user = process.env.FLOW_SMTP_USER?.trim();
  const pass = process.env.FLOW_SMTP_PASS?.trim();
  const from = process.env.FLOW_SMTP_FROM?.trim() || user;
  const port = Number(process.env.FLOW_SMTP_PORT || 465);
  const uniqueRecipients = [...new Set(recipients.map((v) => v.trim().toLowerCase()).filter((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)))];
  if (!host || !user || !pass || !from || !uniqueRecipients.length) return { configured: false, sent: 0, failed: 0 };
  const nodemailer = (await import("nodemailer")).default;
  const transport = nodemailer.createTransport({
    host, port, secure: port === 465, auth: { user, pass },
    connectionTimeout: 12000, socketTimeout: 15000
  });
  let sent = 0;
  let failed = 0;
  for (const to of uniqueRecipients) {
    try { await transport.sendMail({ from, to, subject, text }); sent++; }
    catch { failed++; }
  }
  transport.close();
  return { configured: true, sent, failed };
}
