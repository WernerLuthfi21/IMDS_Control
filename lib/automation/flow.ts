// Pure helpers for the Power Automate bridge (no I/O besides the injected fetch).
export { renderFollowup } from "./render";

export type MailConfig = { host: string; port: number; user: string; pass: string; from: string; inbox: string };
export type FlowConfig = { excelUrl: string | null; emailUrl: string | null; secret: string | null; mail: MailConfig | null };

export function flowConfig(env: Record<string, string | undefined> = process.env): FlowConfig {
  const clean = (v?: string) => (v && /^https:\/\//.test(v.trim()) ? v.trim() : null);
  const t = (v?: string) => v?.trim() || "";
  // Mail transport (no premium licence): the app mails a JSON command to YOUR Outlook inbox; a standard-connector flow reads it.
  const mail = t(env.FLOW_SMTP_HOST) && t(env.FLOW_SMTP_USER) && t(env.FLOW_SMTP_PASS) && /@/.test(t(env.FLOW_INBOX_ADDRESS)) && t(env.POWER_AUTOMATE_SECRET)
    ? { host: t(env.FLOW_SMTP_HOST), port: Number(t(env.FLOW_SMTP_PORT)) || 465, user: t(env.FLOW_SMTP_USER), pass: t(env.FLOW_SMTP_PASS), from: t(env.FLOW_SMTP_FROM) || t(env.FLOW_SMTP_USER), inbox: t(env.FLOW_INBOX_ADDRESS) } : null;
  return { excelUrl: clean(env.POWER_AUTOMATE_EXCEL_URL), emailUrl: clean(env.POWER_AUTOMATE_EMAIL_URL), secret: env.POWER_AUTOMATE_SECRET?.trim() || null, mail };
}

export type RegisterRow = {
  source_record_key: string | null; error_type_label?: string | null; delivery_part_no?: string | null; supplier_code?: string | null;
  assigned_person?: string | null; starting_date?: string | null; judgement_procedure?: string | null; judge?: string | null;
  ok_comment?: string | null; imds_reject_comment?: string | null; km_judge?: string | null; km_comment?: string | null; last_change_date?: string | null;
};

/** Columns AO–AW keyed by the master workbook's header names. `code` is the unique key for "Update a row". */
export function buildExcelPayload(row: RegisterRow) {
  return {
    code: row.source_record_key,
    "Error Type": row.error_type_label ?? "",
    "Delivery Part No": row.delivery_part_no ?? "",
    "Supplier Code": row.supplier_code ?? "",
    "Assigned person": row.assigned_person ?? "",
    "Starting date": row.starting_date ?? "",
    "Judgment procedure": row.judgement_procedure ?? "",
    "Judge OK/NG": row.judge ?? "",
    "Comment of changing to OK": row.ok_comment ?? "",
    "IMDS Reject comment": row.imds_reject_comment ?? "",
    "KM Judge": row.km_judge ?? "",
    "KM Comment": row.km_comment ?? "",
    "Last Change Date": row.last_change_date ?? "",
  };
}

export type PostResult = { ok: boolean; status: number; error?: string; handedOff?: boolean };
/** POST JSON to a flow. Only a 2xx counts as delivered. The secret goes in a header, never in the URL or logs. */
export async function postToFlow(url: string, secret: string | null, payload: unknown, fetchImpl: typeof fetch = fetch, timeoutMs = 20000): Promise<PostResult> {
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(secret ? { "x-imds-secret": secret } : {}) },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status };
    return { ok: false, status: res.status, error: `Flow answered HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message.slice(0, 200) : "Flow request failed" };
  }
}

export type Kind = "EXCEL_UPSERT" | "SUPPLIER_EMAIL";
export function transportFor(kind: Kind, cfg: FlowConfig): "http" | "mail" | null {
  if (kind === "EXCEL_UPSERT" ? cfg.excelUrl : cfg.emailUrl) return "http";
  return cfg.mail ? "mail" : null;
}

/** Subject the flow filters on. The secret in the subject plus the sender filter stop strangers from triggering the flow. */
export function mailSubject(secret: string, type: string) { return `IMDS-SYNC|${secret}|${type}`; }

/** Hand a JSON command to the user's mailbox via SMTP. Success only means SMTP accepted it, NOT that the flow ran. */
export async function sendViaMail(cfg: MailConfig, secret: string, payload: { type: string } & Record<string, unknown>): Promise<PostResult> {
  try {
    const nodemailer = (await import("nodemailer")).default;
    const tx = nodemailer.createTransport({ host: cfg.host, port: cfg.port, secure: cfg.port === 465, auth: { user: cfg.user, pass: cfg.pass }, connectionTimeout: 15000, socketTimeout: 20000 });
    await tx.sendMail({ from: cfg.from, to: cfg.inbox, subject: mailSubject(secret, payload.type), text: JSON.stringify(payload) });
    return { ok: true, status: 250, handedOff: true };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message.slice(0, 200) : "SMTP failed" };
  }
}

export async function deliver(kind: Kind, cfg: FlowConfig, payload: { type: string } & Record<string, unknown>, fetchImpl: typeof fetch = fetch): Promise<PostResult> {
  const mode = transportFor(kind, cfg);
  if (mode === "http") return postToFlow((kind === "EXCEL_UPSERT" ? cfg.excelUrl : cfg.emailUrl)!, cfg.secret, payload, fetchImpl);
  if (mode === "mail" && cfg.mail && cfg.secret) return sendViaMail(cfg.mail, cfg.secret, payload);
  return { ok: false, status: 0, error: "No transport configured" };
}

export const EXCEL_HEADERS = Object.keys(buildExcelPayload({ source_record_key: "" })) as (keyof ReturnType<typeof buildExcelPayload>)[];

/** Fixed test row. Re-running the test updates this same row, so it exercises both "Add a row" (first time) and "Update a row". */
export function buildTestPayload(now: Date = new Date()) {
  return { type: "excel_upsert" as const, ...buildExcelPayload({ source_record_key: "IMDS-PING", error_type_label: "CONNECTION TEST", assigned_person: "Connection test " + now.toISOString().slice(0, 19).replace("T", " ") + " UTC" }) };
}

/** CSV for pasting into the Excel table. Cells starting with = + - @ are prefixed with ' to block formula injection. */
export function toCsv(rows: ReturnType<typeof buildExcelPayload>[]) {
  const cell = (v: unknown) => { let t = String(v ?? ""); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  return "\ufeff" + [EXCEL_HEADERS.join(","), ...rows.map((r) => EXCEL_HEADERS.map((h) => cell(r[h])).join(","))].join("\r\n");
}
