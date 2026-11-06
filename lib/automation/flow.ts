// Pure helpers for the Power Automate bridge (no I/O besides the injected fetch).
import emailTemplates from "@/data/followup-templates.json";

export type FlowConfig = { excelUrl: string | null; emailUrl: string | null; secret: string | null };

export function flowConfig(env: Record<string, string | undefined> = process.env): FlowConfig {
  const clean = (v?: string) => (v && /^https:\/\//.test(v.trim()) ? v.trim() : null);
  return { excelUrl: clean(env.POWER_AUTOMATE_EXCEL_URL), emailUrl: clean(env.POWER_AUTOMATE_EMAIL_URL), secret: env.POWER_AUTOMATE_SECRET?.trim() || null };
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

export function renderFollowup(opts: { errorType: string; supplierName?: string | null; supplierCode: string; partNo: string }) {
  const greeting = opts.supplierName ? `Dear ${opts.supplierName} team,` : "Dear Supplier,";
  const n = opts.errorType.toLowerCase();
  const list = emailTemplates.templates;
  const body = (list.find((t) => t.labels.some((l) => n.includes(l))) || list[list.length - 1]).body
    .replaceAll("{{greeting}}", greeting).replaceAll("{{supplierCode}}", opts.supplierCode).replaceAll("{{partNo}}", opts.partNo).replaceAll("{{errorType}}", opts.errorType);
  return { subject: `IMDS confirmation required · ${opts.partNo} · ${opts.errorType}`, body };
}

export type PostResult = { ok: boolean; status: number; error?: string };
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
