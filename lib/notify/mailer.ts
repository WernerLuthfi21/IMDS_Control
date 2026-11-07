// Approval notification e-mail through SMTP. "ok" means the SMTP server accepted it, not that anyone read it.
export type MailerConfig = { host: string; port: number; user: string; pass: string; from: string };

export function mailerConfig(env: Record<string, string | undefined> = process.env): MailerConfig | null {
  const t = (v?: string) => v?.trim() || "";
  const host = t(env.NOTIFY_SMTP_HOST) || t(env.FLOW_SMTP_HOST), user = t(env.NOTIFY_SMTP_USER) || t(env.FLOW_SMTP_USER), pass = t(env.NOTIFY_SMTP_PASS) || t(env.FLOW_SMTP_PASS);
  if (!host || !user || !pass) return null;
  return { host, port: Number(t(env.NOTIFY_SMTP_PORT) || t(env.FLOW_SMTP_PORT)) || 465, user, pass, from: t(env.NOTIFY_SMTP_FROM) || t(env.FLOW_SMTP_FROM) || user };
}

export async function sendMail(to: string[], subject: string, text: string): Promise<{ ok: boolean; status: string }> {
  const cfg = mailerConfig();
  if (!cfg) return { ok: false, status: "SMTP_NOT_CONFIGURED" };
  if (!to.length) return { ok: false, status: "NO_RECIPIENTS" };
  try {
    const nodemailer = (await import("nodemailer")).default;
    const tx = nodemailer.createTransport({ host: cfg.host, port: cfg.port, secure: cfg.port === 465, auth: { user: cfg.user, pass: cfg.pass }, connectionTimeout: 15000, socketTimeout: 20000 });
    await tx.sendMail({ from: cfg.from, bcc: to, to: cfg.from, subject, text });
    return { ok: true, status: "SMTP_ACCEPTED" };
  } catch { return { ok: false, status: "SMTP_FAILED" }; }
}
