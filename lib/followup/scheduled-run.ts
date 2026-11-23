// One run of an automation (Follow-up → Automatic): read the shared master, the Directory, due dates and the
// follow-up settings; group the outstanding parts per supplier (or one summary e-mail to all suppliers); render the
// chosen template; attach the PDF / Excel / standard files; hand each e-mail to the Power Automate flow (HTTP 202 =
// handed off, not delivered) and log it like a manual send. Used by the hourly cron (service role) and by Preview /
// Draft / Send now in the Tracker (signed-in user). Also builds the reminder e-mail to the TMMIN PIC before a run.
import type { SupabaseClient } from "@supabase/supabase-js";
import { postToFlow } from "@/lib/automation/flow";
import { DEFAULT_CONFIG, mergeCc, sanitizeConfig, type FollowupConfig, type Template } from "./center";
import { resolveContacts, type Directory } from "./directory";
import { buildSupplierEmailPayload, parseSenders, pickSender, type Attachment } from "./payload";
import { gapHoursFromEnv, recentlySent } from "./guard";
import { classifyStatus, modelKey, renderSupplierEmail, TEAM, type Bucket, type DueDates, type RenderPart } from "./render";
import { describe, KIND_NAMES, wibSlot, type Automation } from "./schedule";
import { EXEC_SUMMARY_MAX_AGE_H, EXEC_SUMMARY_NAME, execSummary, pickLibrary, sanitizeLibrary, type Library } from "./library";
import { buildSupplierReportPdf } from "@/lib/imds-master/report-pdf";
import { buildUnsubmittedXlsx, type XlsxPart } from "@/lib/imds-master/report-xlsx";

type Db = SupabaseClient;
export type MasterRow = XlsxPart & { id: string; vendor_code?: string | null; main_pic_email?: string | null; supplier_promise_date?: string | null };
export type PlannedEmail = {
  supplier: string; code: string; parts: number; to: string[]; cc: string[]; toFrom: string; subject: string; body?: string;
  attachments: string[]; skip?: string; status?: "SENT" | "HANDED_OFF" | "FAILED" | "SKIPPED"; error?: string;
  /** Extra information shown in the preview and the reminder (e.g. when the executive summary PDF was made). */
  info?: string;
};
export type RunResult = { automationId: string; name: string; slot: string; dryRun: boolean; planned: PlannedEmail[]; sent: number; failed: number; skipped: number; from: string; note?: string };

const COLS = "id,company_name,vendor_code,project,part_no,part_name,imds_status,imds_id_version,md_id_version,md_status_update_date,submission_plan,supplier_promise_date,comment,main_pic_email";
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

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

export type Context = { cfg: FollowupConfig; dir: Directory; due: DueDates; lib: Library; rows: MasterRow[] };
export async function loadContext(db: Db): Promise<Context> {
  const cfg = sanitizeConfig((await setting(db, "followup_config")) ?? DEFAULT_CONFIG);
  const dir = ((await setting<Directory>(db, "directory")) || {}) as Directory;
  const dueRaw = (await setting<DueDates>(db, "due_dates")) || {};
  const lib = sanitizeLibrary(await setting(db, "attachment_library"));
  return { cfg, dir, due: { models: dueRaw.models || {}, suppliers: dueRaw.suppliers || {} }, lib, rows: await allMasterRows(db) };
}

type Group = { name: string; code: string; email: string; rows: MasterRow[]; parts: RenderPart[] };
/** Outstanding parts per supplier for an automation (status, models, past due). */
export function groupParts(a: Automation, rows: MasterRow[], today: string): Group[] {
  const wanted = new Set<Bucket>(["missing", "rejected", ...(a.includeWorking ? ["process" as Bucket] : [])]);
  const by = new Map<string, Group>();
  for (const r of rows) {
    const status = classifyStatus(r.imds_status), model = modelKey(r.project);
    if (!wanted.has(status) || !r.part_no || (a.models.length && !a.models.includes(model))) continue;
    const company = String(r.company_name || "").trim(); if (!company) continue;
    const g = by.get(company) || { name: company, code: String(r.vendor_code || ""), email: String(r.main_pic_email || ""), rows: [], parts: [] };
    if (!g.parts.some((p) => p.partNo.toUpperCase() === String(r.part_no).toUpperCase() && p.model === model))
      g.parts.push({ partNo: String(r.part_no), partName: String(r.part_name || ""), model, status, target: (r.supplier_promise_date || r.submission_plan || "").slice(0, 10) || null });
    g.rows.push(r); if (!g.code && r.vendor_code) g.code = String(r.vendor_code); if (!g.email && r.main_pic_email) g.email = String(r.main_pic_email);
    by.set(company, g);
  }
  let groups = [...by.values()];
  if (a.onlyPastDue) groups = groups.filter((g) => g.parts.some((p) => p.target && p.target < today));
  return groups.sort((x, y) => y.parts.length - x.parts.length || x.name.localeCompare(y.name));
}

function templateFor(cfg: FollowupConfig, a: Automation): Template {
  return cfg.templates.find((t) => t.id === a.templateId && t.kind === a.kind) || cfg.templates.find((t) => t.id === cfg.defaults[a.kind])!;
}

export type BuildOptions = { now: Date };
/** All e-mails of one run, with recipients and text; `files()` builds that e-mail's attachments on demand. Nothing is sent here. */
export async function buildEmails(ctx: Context, a: Automation, o: BuildOptions) {
  const { cfg, dir, due, lib, rows } = ctx, today = wibSlot(o.now).date;
  const senderShort = a.sender && TEAM[a.sender] ? a.sender : Object.keys(TEAM)[0];
  const senderEmail = TEAM[senderShort];
  const template = templateFor(cfg, a), groups = groupParts(a, rows, today);
  const libFiles = pickLibrary(lib, a.attachments.library);
  const libNames = libFiles.map((f) => f.name);
  const team = Object.values(TEAM);
  const out: { plan: PlannedEmail; files: () => Promise<Attachment[]>; group?: Group; partIds: string[] }[] = [];
  if (a.kind === "recap") {
    const looks = groups.map((g) => resolveContacts(dir, g.name, { vendorCode: g.code, masterEmail: g.email, fallbackMid: a.fallbackMid && cfg.fallbackMid }));
    const to = [...new Set(looks.flatMap((c) => c.to))].slice(0, 400);
    const roleCc = looks.flatMap((c) => [...c.ccAlways, ...(a.cc.mid ? c.mid : []), ...(a.cc.top ? c.top : []), ...(a.cc.dir ? c.dir : []), ...(a.cc.buyer && c.buyer ? c.buyer.emails : [])]);
    const cc = mergeCc({ to, cc: [...team, ...roleCc], required: cfg.requiredCc, senderEmail });
    const parts = groups.flatMap((g) => g.parts);
    const mail = renderSupplierEmail({ template, config: cfg, kind: "recap", supplier: "IMDS Team", code: "", parts, due, sender: senderShort, now: o.now, includeList: false });
    // Only the Tracker's own Executive summary PDF (the same PDF as the "Executive summary PDF" button), saved by the
    // browser. Missing or older than 7 days: the summary is not sent.
    const ex = execSummary(lib, o.now), stamp = o.now.toISOString().slice(0, 10);
    const exWhen = ex ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Jakarta" }).format(new Date(ex.at)) + " WIB" : "";
    const names = ex ? [EXEC_SUMMARY_NAME] : [];
    const files = async () => (ex ? [{ name: `IMDS_Supplier_Submission_Summary_${stamp}.pdf`, contentType: "application/pdf", contentBytes: ex.base64 }] : []) as Attachment[];
    const plan: PlannedEmail = { supplier: `All suppliers (${groups.length})`, code: "", parts: parts.length, to, cc, toFrom: "pic", subject: mail.subject, body: mail.body, attachments: names,
      info: ex ? `Executive summary PDF made by the Tracker on ${exWhen}${ex.ageH > 24 ? " — over a day old; open the Tracker (Follow-up → Automatic) to update it" : ""}.` : "" };
    if (!groups.length) plan.skip = "No supplier has outstanding parts.";
    else if (!to.length) plan.skip = "No e-mail address for any supplier.";
    else if (!ex) plan.skip = "The executive summary PDF has not been made yet: open the Tracker → Follow-up → Automatic once (it is made from the data on screen).";
    else if (ex.ageH > EXEC_SUMMARY_MAX_AGE_H) plan.skip = `The executive summary PDF is ${Math.round(ex.ageH / 24)} days old: open the Tracker → Follow-up → Automatic to update it.`;
    out.push({ plan, files, partIds: groups.flatMap((g) => g.rows.map((r) => r.id)) });
    return { out, senderShort, senderEmail, total: groups.length };
  }
  for (const g of groups.slice(0, a.maxSuppliers)) {
    const c = resolveContacts(dir, g.name, { vendorCode: g.code, masterEmail: g.email, fallbackMid: a.fallbackMid && cfg.fallbackMid });
    const roleCc = [...c.ccAlways, ...(a.cc.mid ? c.mid : []), ...(a.cc.top ? c.top : []), ...(a.cc.dir ? c.dir : []), ...(a.cc.buyer && c.buyer ? c.buyer.emails : [])];
    const cc = mergeCc({ to: c.to, cc: [...team, ...roleCc], required: cfg.requiredCc, senderEmail });
    const mail = renderSupplierEmail({ template, config: cfg, kind: a.kind, supplier: g.name, code: g.code, parts: g.parts, due, sender: senderShort, now: o.now });
    const stem = `IMDS_Outstanding_${g.code || "SUPPLIER"}_${o.now.toISOString().slice(0, 10)}`;
    const names = [a.attachments.pdf ? stem + ".pdf" : "", a.attachments.xlsx ? stem + ".xlsx" : "", ...libNames].filter(Boolean);
    const files = async () => {
      const att: Attachment[] = [];
      const parts = g.rows.map((p) => ({ ...p, submission_plan: p.supplier_promise_date || p.submission_plan }));
      if (a.attachments.pdf) att.push({ name: stem + ".pdf", contentType: "application/pdf", contentBytes: buildSupplierReportPdf(g.name, g.code, parts).toString("base64") });
      if (a.attachments.xlsx) att.push({ name: stem + ".xlsx", contentType: XLSX_TYPE, contentBytes: (await buildUnsubmittedXlsx(g.name, g.code, parts)).toString("base64") });
      att.push(...libFiles);
      return att;
    };
    const plan: PlannedEmail = { supplier: g.name, code: g.code, parts: g.parts.length, to: c.to, cc, toFrom: c.toFrom, subject: mail.subject, body: mail.body, attachments: names };
    if (!c.to.length) plan.skip = "No e-mail address (no IMDS PIC, no middle management, nothing in the master).";
    out.push({ plan, files, group: g, partIds: g.rows.map((r) => r.id) });
  }
  return { out, senderShort, senderEmail, total: groups.length };
}

export type RunOptions = { now: Date; dryRun: boolean; actorId: string | null; budgetMs?: number; fetchImpl?: typeof fetch; withBodies?: boolean; slot?: string };

export async function runAutomation(db: Db, a: Automation, o: RunOptions, ctxIn?: Context): Promise<RunResult> {
  const started = Date.now(), budget = o.budgetMs ?? 240_000;
  const ctx = ctxIn || await loadContext(db), slot = o.slot || wibSlot(o.now).key;
  const built = await buildEmails(ctx, a, { now: o.now });
  const { data: logs } = await db.from("imds_tracker_followup_logs").select("supplier_name,sent_at").eq("status", "SENT").gte("sent_at", new Date(o.now.getTime() - 14 * 86400000).toISOString()).order("sent_at", { ascending: false }).limit(3000);
  const lastSent: Record<string, string> = {};
  for (const l of (logs || []) as { supplier_name: string; sent_at: string }[]) if (l.supplier_name && !lastSent[l.supplier_name]) lastSent[l.supplier_name] = l.sent_at;
  const gap = gapHoursFromEnv(process.env.FOLLOWUP_MIN_GAP_HOURS);
  const sender = pickSender(parseSenders(process.env.FOLLOWUP_SENDERS), built.senderEmail);
  const url = process.env.POWER_AUTOMATE_EMAIL_URL?.trim(), secret = process.env.POWER_AUTOMATE_SECRET?.trim() || null;
  const canSend = Boolean(url && /^https:\/\//i.test(url) && secret);
  const result: RunResult = { automationId: a.id, name: a.name, slot, dryRun: o.dryRun, planned: [], sent: 0, failed: 0, skipped: 0, from: sender ? `${sender.name} <${sender.email}>` : "the flow's own mailbox" };
  if (!o.dryRun && !canSend) result.note = "Power Automate is not configured (POWER_AUTOMATE_EMAIL_URL + POWER_AUTOMATE_SECRET). Nothing was sent.";
  if (a.kind !== "recap" && built.total > a.maxSuppliers) result.note = [result.note, `${built.total - a.maxSuppliers} more supplier(s) are over the per-run limit (${a.maxSuppliers}).`].filter(Boolean).join(" ");

  for (const raw of built.out) {
    const item = { ...raw, body: raw.plan.body || "" };
    const plan = item.plan, logName = a.kind === "recap" ? "ALL SUPPLIERS (RECAP)" : plan.supplier;
    if (!o.withBodies) delete plan.body;
    if (!plan.skip && a.kind !== "recap" && recentlySent(lastSent[logName], o.now, gap)) plan.skip = `Already e-mailed within ${gap} h.`;
    result.planned.push(plan);
    if (plan.skip) { plan.status = "SKIPPED"; result.skipped++; continue; }
    if (o.dryRun || !canSend) continue;
    if (Date.now() - started > budget) { plan.status = "SKIPPED"; plan.skip = "Time limit of this run reached; it is included in the next run."; result.skipped++; continue; }
    const one = item;
    let attachments: Attachment[] = [];
    try { attachments = await item.files(); }
    catch (e) { plan.status = "FAILED"; plan.error = "Attachments could not be built: " + (e instanceof Error ? e.message : String(e)); result.failed++; continue; }
    const body = item.body;
    const { data: log } = await db.from("imds_tracker_followup_logs").insert({
      supplier_code: plan.code || null, supplier_name: logName, recipient_email: plan.to.join(";"), cc_emails: plan.cc, subject: plan.subject, message_body: body,
      part_count: plan.parts, attachment_name: attachments.map((x) => x.name).join(", ") || null, status: "PREPARED", sent_by: o.actorId
    }).select("id").single();
    let payload;
    try {
      payload = buildSupplierEmailPayload({ source: "tracker", followupId: log?.id, logId: log?.id, supplierCode: plan.code, supplierName: logName, to: plan.to, cc: plan.cc, sender, subject: plan.subject, body, attachments, font: ctx.cfg.font,
        metadata: { partCount: plan.parts, projects: [...new Set((one?.group?.parts || []).map((p) => p.model))].sort(), items: plan.parts } });
    } catch (e) {
      plan.status = "FAILED"; plan.error = e instanceof Error ? e.message : "Could not prepare the e-mail."; result.failed++;
      if (log?.id) await db.from("imds_tracker_followup_logs").update({ status: "FAILED", error_message: plan.error }).eq("id", log.id);
      continue;
    }
    const d = await postToFlow(url as string, secret, payload, o.fetchImpl);
    if (log?.id) await db.from("imds_tracker_followup_logs").update({
      status: d.ok ? "SENT" : "FAILED", sent_at: d.ok ? new Date().toISOString() : null,
      error_message: d.error || `Automation "${a.name}"${d.handedOff ? ": accepted by the flow (HTTP 202); check the flow run history for the actual send." : "."}`,
      provider_response: { httpStatus: d.status, ok: d.ok, handedOff: Boolean(d.handedOff), automation: a.id, slot }
    }).eq("id", log.id);
    if (d.ok) { plan.status = d.handedOff ? "HANDED_OFF" : "SENT"; result.sent++; } else { plan.status = "FAILED"; plan.error = d.error; result.failed++; }
  }
  return result;
}

/** One e-mail of a run with its attachments (for "Download draft" in the preview). */
export async function draftFor(ctx: Context, a: Automation, supplier: string, now: Date) {
  const b = await buildEmails(ctx, { ...a, maxSuppliers: 300 }, { now });
  const hit = b.out.find((x) => x.plan.supplier === supplier);
  return hit ? { plan: hit.plan, attachments: await hit.files() } : null;
}

/** Reminder to the TMMIN PIC before a run: what will go out, to whom, with which files, and how to stop it. */
export function noticeEmail(a: Automation, r: RunResult, runAt: Date, appUrl: string) {
  const when = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Jakarta" }).format(runAt) + " WIB";
  const send = r.planned.filter((p) => !p.skip), skip = r.planned.filter((p) => p.skip);
  const lines = send.slice(0, 60).map((p, i) => `${i + 1}. ${p.supplier} — ${p.parts} part(s) — To: ${p.to.join(", ")}${p.toFrom === "mid" ? " (no IMDS PIC: middle management)" : ""} — CC: ${p.cc.length} — Files: ${p.attachments.join(", ") || "none"}${p.info ? " — " + p.info : ""}`);
  const subject = `[IMDS automation] "${a.name}" will send ${send.length} e-mail(s) on ${when}`.slice(0, 240);
  const body = [
    "Hello,", "",
    `This is a reminder that the automation "${a.name}" (${KIND_NAMES[a.kind]}) will send ${send.length} e-mail(s) on ${when} (${describe(a)}).`,
    `Sender: ${r.from}.`, "",
    "E-mails that will be sent:", ...(lines.length ? lines : ["(none)"]), ...(send.length > 60 ? [`… and ${send.length - 60} more.`] : []), "",
    ...(skip.length ? ["Skipped:", ...skip.slice(0, 30).map((p) => `- ${p.supplier}: ${p.skip}`), ""] : []),
    ...(r.note ? [`Note: ${r.note}`, ""] : []),
    `To check each e-mail, change it, skip this run or switch the automation off, open the IMDS Tracker → Follow-up → Automatic${appUrl ? ": " + appUrl.replace(/\/$/, "") + "/imds-tracker#followup" : "."}`,
    "Nothing is sent before the time above. This message itself went only to you.", "",
    "IMDS Tracker (automatic reminder)"
  ].join("\n");
  return { subject, body };
}
