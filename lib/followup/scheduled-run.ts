// One run of the weekly automatic follow-up: read the shared master, the Directory, due dates and the follow-up
// settings; group the outstanding parts per supplier; render the default template; attach PDF / Excel / check form;
// hand each e-mail to the Power Automate flow (HTTP 202 = handed off, not delivered) and log it like a manual send.
// Used by the hourly cron (/api/cron/followups, service role) and by "Preview" / "Run now" in Settings (signed-in user).
import type { SupabaseClient } from "@supabase/supabase-js";
import { postToFlow } from "@/lib/automation/flow";
import { DEFAULT_CONFIG, mergeCc, sanitizeConfig, type FollowupConfig } from "./center";
import { resolveContacts, type Directory } from "./directory";
import { buildSupplierEmailPayload, parseSenders, pickSender, type Attachment } from "./payload";
import { gapHoursFromEnv, recentlySent } from "./guard";
import { classifyStatus, modelKey, renderSupplierEmail, TEAM, type Bucket, type DueDates, type RenderPart } from "./render";
import { wibSlot, type Schedule } from "./schedule";
import { buildCheckFormXlsx, partKey, type CheckFormContact } from "./check-form";
import { buildSupplierReportPdf } from "@/lib/imds-master/report-pdf";
import { buildUnsubmittedXlsx, type XlsxPart } from "@/lib/imds-master/report-xlsx";

type Db = SupabaseClient;
export type MasterRow = XlsxPart & { id: string; vendor_code?: string | null; main_pic_email?: string | null; supplier_promise_date?: string | null };
export type PlannedEmail = {
  supplier: string; code: string; parts: number; to: string[]; cc: string[]; toFrom: string; subject: string;
  attachments: string[]; skip?: string; status?: "SENT" | "HANDED_OFF" | "FAILED" | "SKIPPED"; error?: string;
};
export type RunResult = { slot: string; dryRun: boolean; planned: PlannedEmail[]; sent: number; failed: number; skipped: number; note?: string };

const COLS = "id,company_name,vendor_code,project,part_no,part_name,imds_status,imds_id_version,md_id_version,md_status_update_date,submission_plan,supplier_promise_date,comment,main_pic_email";

async function setting<T>(db: Db, key: string): Promise<T | null> {
  const { data } = await db.from("imds_tracker_settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as T) ?? null;
}
async function allMasterRows(db: Db): Promise<MasterRow[]> {
  const out: MasterRow[] = [];
  for (let from = 0; from < 60000; from += 1000) {
    const { data, error } = await db.from("imds_master_parts").select(COLS).order("id").range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data || []) as unknown as MasterRow[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Recorded G-CATS findings per part number for one supplier code (label, substance, CAS), newest first, max 5. */
export async function findingsFor(db: Db, supplierCode: string): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  if (!supplierCode) return out;
  const { data } = await db.from("gcat_error_items").select("delivery_part_no,error_type_label,substance_name,cas_no,created_at").eq("supplier_code", supplierCode).order("created_at", { ascending: false }).limit(3000);
  for (const r of (data || []) as { delivery_part_no?: string | null; error_type_label?: string | null; substance_name?: string | null; cas_no?: string | null }[]) {
    const k = partKey(r.delivery_part_no); if (!k) continue;
    const t = [r.error_type_label, r.substance_name ? `substance ${r.substance_name}` : "", r.cas_no ? `CAS ${r.cas_no}` : ""].filter(Boolean).join(" · ");
    const list = out[k] || (out[k] = []);
    if (t && !list.includes(t) && list.length < 5) list.push(t);
  }
  return out;
}

/** Current contacts from the Directory, for sheet 3 of the check form. */
export function formContacts(dir: Directory, entryKey: string | null): CheckFormContact[] {
  const f = entryKey ? (dir.entries || {})[entryKey]?.f || {} : {};
  const one = (role: string, p: string): CheckFormContact => ({ role, name: f[p + "_name"], division: f[p + "_position"], email: f[p + "_email"], phone: f[p + "_phone"] });
  const top = f.md_email ? one("Top Management", "md") : f.vp_email ? one("Top Management", "vp") : one("Top Management", "pd");
  return [one("PIC #1", "pic1"), one("PIC #2", "pic2"), top];
}

export async function buildAttachments(db: Db, a: { pdf: boolean; xlsx: boolean; checkForm: boolean }, supplier: string, code: string, rows: MasterRow[], contacts: CheckFormContact[], now: Date): Promise<Attachment[]> {
  const stem = `IMDS_Outstanding_${code || "SUPPLIER"}_${now.toISOString().slice(0, 10)}`, out: Attachment[] = [];
  const parts = rows.map((p) => ({ ...p, submission_plan: p.supplier_promise_date || p.submission_plan }));
  if (a.pdf && parts.length) out.push({ name: `${stem}.pdf`, contentType: "application/pdf", contentBytes: buildSupplierReportPdf(supplier, code, parts).toString("base64") });
  if (a.xlsx && parts.length) out.push({ name: `${stem}.xlsx`, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", contentBytes: (await buildUnsubmittedXlsx(supplier, code, parts)).toString("base64") });
  if (a.checkForm && parts.length) {
    const findings = await findingsFor(db, code);
    const buf = await buildCheckFormXlsx({ supplierName: supplier, supplierCode: code, parts, findings, contacts, generatedAt: now });
    out.push({ name: `IMDS_Supplier_Check_Form_${code || "SUPPLIER"}_${now.toISOString().slice(0, 10)}.xlsx`, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", contentBytes: buf.toString("base64") });
  }
  return out;
}

export type RunOptions = { now: Date; dryRun: boolean; actorId: string | null; budgetMs?: number; fetchImpl?: typeof fetch; schedule?: Schedule };

export async function runScheduledFollowups(db: Db, o: RunOptions): Promise<RunResult> {
  const started = Date.now(), budget = o.budgetMs ?? 240_000;
  const cfg: FollowupConfig = sanitizeConfig((await setting(db, "followup_config")) ?? DEFAULT_CONFIG);
  const s = o.schedule ?? cfg.schedule, slot = wibSlot(o.now).key;
  const dir = ((await setting<Directory>(db, "directory")) || {}) as Directory;
  const dueRaw = ((await setting<{ models?: Record<string, string>; suppliers?: Record<string, string> }>(db, "due_dates")) || {});
  const due: DueDates = { models: dueRaw.models || {}, suppliers: dueRaw.suppliers || {} };
  const template = cfg.templates.find((t) => t.id === s.templateId && t.kind === s.kind) || cfg.templates.find((t) => t.id === cfg.defaults[s.kind])!;
  const wanted = new Set<Bucket>(["missing", "rejected", ...(s.includeWorking ? ["process" as Bucket] : [])]);
  const today = wibSlot(o.now).date;

  const rows = await allMasterRows(db);
  const bySupplier = new Map<string, { code: string; email: string; rows: MasterRow[]; parts: RenderPart[] }>();
  for (const r of rows) {
    const status = classifyStatus(r.imds_status), model = modelKey(r.project);
    if (!wanted.has(status) || !r.part_no) continue;
    if (s.models.length && !s.models.includes(model)) continue;
    const company = String(r.company_name || "").trim(); if (!company) continue;
    const g = bySupplier.get(company) || { code: String(r.vendor_code || ""), email: String(r.main_pic_email || ""), rows: [], parts: [] };
    if (!g.parts.some((p) => p.partNo.toUpperCase() === String(r.part_no).toUpperCase() && p.model === model)) {
      g.parts.push({ partNo: String(r.part_no), partName: String(r.part_name || ""), model, status, target: (r.supplier_promise_date || r.submission_plan || "").slice(0, 10) || null });
    }
    g.rows.push(r); if (!g.code && r.vendor_code) g.code = String(r.vendor_code); if (!g.email && r.main_pic_email) g.email = String(r.main_pic_email);
    bySupplier.set(company, g);
  }
  let groups = [...bySupplier.entries()].map(([name, g]) => ({ name, ...g }));
  if (s.onlyPastDue) groups = groups.filter((g) => g.parts.some((p) => p.target && p.target < today));
  groups.sort((a, b) => b.parts.length - a.parts.length || a.name.localeCompare(b.name));

  const { data: logs } = await db.from("imds_tracker_followup_logs").select("supplier_name,sent_at").eq("status", "SENT").gte("sent_at", new Date(o.now.getTime() - 14 * 86400000).toISOString()).order("sent_at", { ascending: false }).limit(3000);
  const lastSent: Record<string, string> = {};
  for (const l of (logs || []) as { supplier_name: string; sent_at: string }[]) if (l.supplier_name && !lastSent[l.supplier_name]) lastSent[l.supplier_name] = l.sent_at;
  const gap = gapHoursFromEnv(process.env.FOLLOWUP_MIN_GAP_HOURS);
  const allowed = parseSenders(process.env.FOLLOWUP_SENDERS);
  const senderShort = s.sender && TEAM[s.sender] ? s.sender : Object.keys(TEAM)[0];
  const sender = pickSender(allowed, TEAM[senderShort]);
  const url = process.env.POWER_AUTOMATE_EMAIL_URL?.trim(), secret = process.env.POWER_AUTOMATE_SECRET?.trim() || null;
  const canSend = Boolean(url && /^https:\/\//i.test(url) && secret);

  const result: RunResult = { slot, dryRun: o.dryRun, planned: [], sent: 0, failed: 0, skipped: 0 };
  if (!o.dryRun && !canSend) result.note = "Power Automate is not configured (POWER_AUTOMATE_EMAIL_URL + POWER_AUTOMATE_SECRET). Nothing was sent.";

  for (const g of groups.slice(0, s.maxSuppliers)) {
    const c = resolveContacts(dir, g.name, { vendorCode: g.code, masterEmail: g.email, fallbackMid: s.fallbackMid && cfg.fallbackMid });
    const roleCc = [...c.ccAlways, ...(s.cc.mid ? c.mid : []), ...(s.cc.top ? c.top : []), ...(s.cc.dir ? c.dir : []), ...(s.cc.buyer && c.buyer ? c.buyer.emails : [])];
    const team = Object.values(TEAM);
    const cc = mergeCc({ to: c.to, cc: [...team, ...roleCc], required: cfg.requiredCc, senderEmail: sender?.email || TEAM[senderShort] });
    const mail = renderSupplierEmail({ template, config: cfg, kind: s.kind, supplier: g.name, code: g.code, parts: g.parts, due, sender: senderShort, now: o.now });
    const names = [s.attachments.pdf && "PDF", s.attachments.xlsx && "Excel list", s.attachments.checkForm && "Check form"].filter(Boolean) as string[];
    const plan: PlannedEmail = { supplier: g.name, code: g.code, parts: g.parts.length, to: c.to, cc, toFrom: c.toFrom, subject: mail.subject, attachments: names };
    if (!c.to.length) plan.skip = "No e-mail address (no IMDS PIC, no middle management, nothing in the master).";
    else if (recentlySent(lastSent[g.name], o.now, gap)) plan.skip = `Already e-mailed within ${gap} h.`;
    result.planned.push(plan);
    if (plan.skip) { plan.status = "SKIPPED"; result.skipped++; continue; }
    if (o.dryRun || !canSend) continue;
    if (Date.now() - started > budget) { plan.status = "SKIPPED"; plan.skip = "Time limit of this run reached; it is sent on the next scheduled run."; result.skipped++; continue; }

    const contacts = formContacts(dir, c.entryKey);
    let attachments: Attachment[] = [];
    try { attachments = await buildAttachments(db, s.attachments, g.name, g.code, g.rows, contacts, o.now); }
    catch (e) { plan.status = "FAILED"; plan.error = "Attachments could not be built: " + (e instanceof Error ? e.message : String(e)); result.failed++; continue; }
    const { data: log } = await db.from("imds_tracker_followup_logs").insert({
      supplier_code: g.code || null, supplier_name: g.name, recipient_email: c.to.join(";"), cc_emails: cc, subject: mail.subject, message_body: mail.body,
      part_count: g.parts.length, attachment_name: attachments.map((a) => a.name).join(", ") || null, status: "PREPARED", sent_by: o.actorId
    }).select("id").single();
    let payload;
    try {
      payload = buildSupplierEmailPayload({ source: "tracker", followupId: log?.id, logId: log?.id, supplierCode: g.code, supplierName: g.name, to: c.to, cc, sender, subject: mail.subject, body: mail.body, attachments, font: cfg.font,
        metadata: { partCount: g.parts.length, projects: [...new Set(g.parts.map((p) => p.model))].sort(), items: g.parts.length } });
    } catch (e) {
      plan.status = "FAILED"; plan.error = e instanceof Error ? e.message : "Could not prepare the e-mail."; result.failed++;
      if (log?.id) await db.from("imds_tracker_followup_logs").update({ status: "FAILED", error_message: plan.error }).eq("id", log.id);
      continue;
    }
    const d = await postToFlow(url as string, secret, payload, o.fetchImpl);
    if (log?.id) await db.from("imds_tracker_followup_logs").update({
      status: d.ok ? "SENT" : "FAILED", sent_at: d.ok ? new Date().toISOString() : null,
      error_message: d.error || (d.handedOff ? "Scheduled run: accepted by the flow (HTTP 202); check the flow run history for the actual send." : "Scheduled run."),
      provider_response: { httpStatus: d.status, ok: d.ok, handedOff: Boolean(d.handedOff), scheduled: slot }
    }).eq("id", log.id);
    if (d.ok) { plan.status = d.handedOff ? "HANDED_OFF" : "SENT"; result.sent++; } else { plan.status = "FAILED"; plan.error = d.error; result.failed++; }
  }
  if (groups.length > s.maxSuppliers) result.note = [result.note, `${groups.length - s.maxSuppliers} more supplier(s) were over the per-run limit (${s.maxSuppliers}).`].filter(Boolean).join(" ");
  return result;
}
