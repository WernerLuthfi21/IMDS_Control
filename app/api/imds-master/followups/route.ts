import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { canAccessImdsTracker } from "@/lib/security/imds-tracker";
import { postToFlow } from "@/lib/automation/flow";
import { resolveRecipients, emailsOf, type ContactRow } from "@/lib/followup/recipients";
import { buildSupplierEmailPayload, parseSenders, pickSender } from "@/lib/followup/payload";
import { gapHoursFromEnv, recentlySent } from "@/lib/followup/guard";
import { buildSupplierReportPdf } from "@/lib/imds-master/report-pdf";
import { buildUnsubmittedXlsx } from "@/lib/imds-master/report-xlsx";
import { DEFAULT_CONFIG, directoryEmails, partListText, renderTemplate, resolveCc, sanitizeConfig, selectParts, type FollowupConfig } from "@/lib/followup/center";

export const runtime = "nodejs";
export const maxDuration = 60;

type MasterPart = Record<string, unknown> & {
  id: string;
  vendor_code: string | null;
  company_name: string | null;
  main_pic_email: string | null;
  project: string | null;
  part_no: string | null;
  part_name: string | null;
  imds_status: string | null;
  submission_plan: string | null;
  supplier_promise_date: string | null;
  imds_id_version: string | null;
  md_id_version: string | null;
  status_update: string | null;
  md_status_update_date: string | null;
  comment: string | null;
};

type Db = NonNullable<Awaited<ReturnType<typeof createClient>>>;
type Options = { models: string[]; scope: "action" | "all"; templateId: string; roles: { mid: boolean; top: boolean; buyer: boolean }; extraCc: string[]; senderName: string };

function supplierKey(part: MasterPart) {
  return `${String(part.vendor_code || "").trim().toUpperCase()}|${String(part.company_name || "").trim().toUpperCase()}`;
}

async function loadSettings(supabase: Db) {
  const { data } = await supabase.from("imds_tracker_settings").select("key,value").in("key", ["followup_config", "directory"]);
  const byKey = new Map((data || []).map((r) => [r.key as string, r.value]));
  return { config: sanitizeConfig(byKey.get("followup_config") ?? DEFAULT_CONFIG), directory: byKey.get("directory") ?? null };
}

async function loadSupplierGroups(supabase: Db, opts: Options, config: FollowupConfig, directory: unknown) {
  const parts: MasterPart[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await supabase.from("imds_master_parts")
      .select("id,master_key,project,vendor_code,main_pic_email,company_name,part_name,part_no,submission_plan,supplier_promise_date,imds_status,imds_id_version,md_id_version,status_update,md_status_update_date,comment")
      .order("company_name").order("part_no").range(from, from + 999);
    if (error) throw new Error(error.message);
    parts.push(...(data || []) as MasterPart[]);
    if (!data || data.length < 1000) break;
  }
  const models = [...new Set(parts.map((p) => String(p.project || "").trim()).filter(Boolean))].sort();

  const { data: contacts, error: contactsError } = await supabase.from("supplier_contacts")
    .select("supplier_code,supplier_name,email,contact_role,active").eq("active", true).limit(10000);
  if (contactsError) throw new Error(contactsError.message);

  const grouped = new Map<string, MasterPart[]>();
  for (const part of selectParts(parts, opts.scope, opts.models)) {
    const key = supplierKey(part);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(part);
  }
  const template = config.templates.find((t) => t.id === opts.templateId) || config.templates.find((t) => t.id === config.defaultTemplateId) || config.templates[0];
  const dateTag = new Date().toISOString().slice(0, 10);

  const suppliers = [];
  for (const group of grouped.values()) {
    const first = group[0];
    const code = String(first.vendor_code || "");
    const company = String(first.company_name || "Unknown supplier");
    const recipients = resolveRecipients({ supplierCode: code, contacts: (contacts || []) as ContactRow[], mainPicEmails: group.flatMap((part) => emailsOf(part.main_pic_email)) });
    const dir = directoryEmails(directory, code, company);
    let to = recipients.to;
    let source: string = recipients.source;
    const warnings = [...recipients.warnings];
    if (!to.length && dir.pic.length) { to = dir.pic; source = "directory"; warnings.length = 0; }
    const { cc, required } = resolveCc({ to, supplierCc: recipients.cc, directory: dir, config, roles: opts.roles, extra: opts.extraCc });
    const projects = [...new Set(group.map((part) => String(part.project || "").trim()).filter(Boolean))].sort();
    const ctx = { supplier: company, code: code || "-", count: group.length, models: projects.join(", ") || "-", partlist: partListText(group, config.maxPartsInBody), sender: opts.senderName, date: dateTag };
    const partRows = group.map((part, index) => ({
      id: part.id, project: part.project, part_no: part.part_no, part_name: part.part_name, imds_status: part.imds_status,
      submission_plan: part.supplier_promise_date || part.submission_plan, imds_id_version: part.imds_id_version, md_id_version: part.md_id_version,
      status_update: part.status_update, md_status_update_date: part.md_status_update_date, comment: part.comment, sequence: index + 1
    }));
    suppliers.push({
      supplierCode: code, supplierName: company, to, cc, requiredCc: required,
      subject: renderTemplate(template.subject, ctx), body: renderTemplate(template.body, ctx),
      partCount: group.length, projects, parts: partRows, emailReady: to.length > 0,
      recipientSource: source, warnings, noDirectoryEntry: !dir.pic.length && !dir.mid.length && !dir.top.length
    });
  }
  suppliers.sort((a, b) => b.partCount - a.partCount || a.supplierName.localeCompare(b.supplierName));
  return { suppliers, models };
}

function optionsFrom(config: FollowupConfig, src: { models?: unknown; scope?: unknown; templateId?: unknown; roles?: Partial<Record<"mid" | "top" | "buyer", unknown>> | null; extraCc?: unknown }, senderName: string): Options {
  const models = (Array.isArray(src.models) ? src.models : String(src.models ?? "").split(",")).map((m) => String(m).trim()).filter(Boolean).slice(0, 100);
  const r = src.roles || {};
  return {
    models, scope: src.scope === "all" ? "all" : src.scope === "action" ? "action" : config.statusScope,
    templateId: String(src.templateId || config.defaultTemplateId),
    roles: { mid: r.mid === undefined ? config.ccRoles.mid : r.mid === true || r.mid === "1", top: r.top === undefined ? config.ccRoles.top : r.top === true || r.top === "1", buyer: r.buyer === undefined ? config.ccRoles.buyer : r.buyer === true || r.buyer === "1" },
    extraCc: (Array.isArray(src.extraCc) ? src.extraCc : String(src.extraCc ?? "").split(/[;,\s]+/)).map(String), senderName
  };
}

export async function GET(request: NextRequest) {
  const auth = await getAuthContext();
  if (!auth.configured) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  if (!auth.userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!canAccessImdsTracker(auth.role)) return NextResponse.json({ error: "Internal workspace access required." }, { status: 403 });
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });

  try {
    const { config, directory } = await loadSettings(supabase);
    const q = request.nextUrl.searchParams;
    const senders = parseSenders(process.env.FOLLOWUP_SENDERS);
    const senderName = pickSender(senders, q.get("sender"))?.name || auth.displayName || "IMDS Team";
    const opts = optionsFrom(config, { models: q.get("models"), scope: q.get("scope"), templateId: q.get("template"), roles: { mid: q.get("ccMid") ?? undefined, top: q.get("ccTop") ?? undefined, buyer: q.get("ccBuyer") ?? undefined }, extraCc: q.get("extraCc") }, senderName);
    const { suppliers, models } = await loadSupplierGroups(supabase, opts, config, directory);
    return NextResponse.json({
      suppliers, models, config,
      applied: { scope: opts.scope, models: opts.models, templateId: opts.templateId, roles: opts.roles },
      configured: Boolean(process.env.POWER_AUTOMATE_EMAIL_URL?.trim() && process.env.POWER_AUTOMATE_SECRET?.trim()),
      senders,
      canConfigure: ["admin", "preparer"].includes(auth.role || ""),
      sendMode: "one supplier per request; sequential sending is controlled by the website"
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not prepare supplier follow-ups." }, { status: 500 });
  }
}

type SendBody = {
  supplierCode?: string; supplierName?: string; subject?: string; messageBody?: string; sender?: string; force?: boolean;
  models?: string[]; scope?: string; templateId?: string; roles?: { mid?: boolean; top?: boolean; buyer?: boolean }; extraCc?: string[];
  attachments?: { pdf?: boolean; xlsx?: boolean };
};

export async function POST(request: NextRequest) {
  const auth = await getAuthContext();
  if (!auth.configured) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  if (!auth.userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!["admin", "preparer", "reviewer"].includes(auth.role || "")) {
    return NextResponse.json({ error: "Admin, preparer or reviewer role is required to send supplier follow-ups." }, { status: 403 });
  }
  const body = await request.json().catch(() => null) as SendBody | null;
  if (!body?.supplierName) return NextResponse.json({ error: "Choose one supplier to follow up." }, { status: 400 });

  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const allowedSenders = parseSenders(process.env.FOLLOWUP_SENDERS);
  const sender = pickSender(allowedSenders, body.sender);
  if (body.sender && !sender) return NextResponse.json({ error: "That sender mailbox is not on the allowed list (FOLLOWUP_SENDERS). Nothing was sent." }, { status: 422 });

  let supplier;
  let config: FollowupConfig;
  try {
    const settings = await loadSettings(supabase);
    config = settings.config;
    const opts = optionsFrom(config, body, sender?.name || auth.displayName || "IMDS Team");
    const loaded = await loadSupplierGroups(supabase, opts, config, settings.directory);
    supplier = loaded.suppliers.find((item) => item.supplierName === body.supplierName && item.supplierCode === (body.supplierCode || ""));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load supplier parts." }, { status: 500 }); }

  if (!supplier) return NextResponse.json({ error: "This supplier has no parts matching the chosen filters in the shared master." }, { status: 404 });
  if (!supplier.to.length) return NextResponse.json({ error: "No valid supplier PIC email is registered. Update the supplier Directory first." }, { status: 422 });

  const gapHours = gapHoursFromEnv(process.env.FOLLOWUP_MIN_GAP_HOURS);
  if (!body.force && gapHours > 0) {
    const { data: last } = await supabase.from("imds_tracker_followup_logs").select("sent_at")
      .eq("supplier_name", supplier.supplierName).eq("status", "SENT").order("sent_at", { ascending: false }).limit(1);
    if (recentlySent(last?.[0]?.sent_at, new Date(), gapHours)) {
      return NextResponse.json({ error: `A follow-up was already sent to ${supplier.supplierName} within the last ${gapHours} hours. Nothing was sent.`, skipped: "RECENTLY_SENT" }, { status: 409 });
    }
  }
  const emailUrl = process.env.POWER_AUTOMATE_EMAIL_URL?.trim();
  const flowSecret = process.env.POWER_AUTOMATE_SECRET?.trim() || null;
  if (!emailUrl || !/^https:\/\//i.test(emailUrl) || !flowSecret) {
    return NextResponse.json({ error: "POWER_AUTOMATE_EMAIL_URL and POWER_AUTOMATE_SECRET must both be configured. The message was not sent.", prepared: true }, { status: 503 });
  }

  const cc = supplier.cc;   // already includes the REQUIRED cc, the chosen management roles and any extra address
  const subject = String(body.subject || supplier.subject).trim().slice(0, 240);
  const messageBody = String(body.messageBody || supplier.body).trim().slice(0, 30000);
  const dateTag = new Date().toISOString().slice(0, 10);
  const wantPdf = body.attachments?.pdf ?? config.attachments.pdf;
  const wantXlsx = body.attachments?.xlsx ?? config.attachments.xlsx;
  const stem = `IMDS_Outstanding_${supplier.supplierCode || "SUPPLIER"}_${dateTag}`;
  const attachments: { name: string; contentType: string; contentBytes: string }[] = [];
  if (wantPdf) attachments.push({ name: `${stem}.pdf`, contentType: "application/pdf", contentBytes: buildSupplierReportPdf(supplier.supplierName, supplier.supplierCode, supplier.parts).toString("base64") });
  if (wantXlsx) attachments.push({ name: `${stem}.xlsx`, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", contentBytes: (await buildUnsubmittedXlsx(supplier.supplierName, supplier.supplierCode, supplier.parts)).toString("base64") });
  const attachmentName = attachments.map((a) => a.name).join(", ");

  const { data: log, error: logError } = await supabase.from("imds_tracker_followup_logs").insert({
    supplier_code: supplier.supplierCode || null, supplier_name: supplier.supplierName, recipient_email: supplier.to.join(";"),
    cc_emails: cc, subject, message_body: messageBody, part_count: supplier.partCount, attachment_name: attachmentName || null,
    status: "PREPARED", sent_by: auth.userId
  }).select("id").single();
  if (logError || !log) return NextResponse.json({ error: logError?.message || "Could not record follow-up attempt." }, { status: 500 });

  let payload;
  try {
    payload = buildSupplierEmailPayload({
      source: "tracker", followupId: log.id, logId: log.id,
      supplierCode: supplier.supplierCode, supplierName: supplier.supplierName,
      to: supplier.to, cc, sender, subject, body: messageBody, attachments,
      metadata: { partCount: supplier.partCount, projects: supplier.projects, items: supplier.partCount }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not prepare the e-mail.";
    await supabase.from("imds_tracker_followup_logs").update({ status: "FAILED", error_message: message }).eq("id", log.id);
    return NextResponse.json({ error: message, logId: log.id }, { status: 422 });
  }
  const delivery = await postToFlow(emailUrl, flowSecret, payload);

  const status = delivery.ok ? "SENT" : "FAILED";
  await supabase.from("imds_tracker_followup_logs").update({
    status, sent_at: delivery.ok ? new Date().toISOString() : null, error_message: delivery.error || null,
    provider_response: { httpStatus: delivery.status, ok: delivery.ok }
  }).eq("id", log.id);
  await supabase.from("audit_events").insert({
    actor_id: auth.userId,
    action: delivery.ok ? "IMDS_TRACKER_SUPPLIER_EMAIL_SENT" : "IMDS_TRACKER_SUPPLIER_EMAIL_FAILED",
    entity_type: "imds_tracker_followup", entity_id: log.id,
    metadata: { supplierCode: supplier.supplierCode, recipientCount: supplier.to.length, ccCount: cc.length, parts: supplier.partCount, attachments: attachments.map((a) => a.name), status }
  });

  if (!delivery.ok) return NextResponse.json({ error: delivery.error || "Power Automate did not accept this supplier e-mail.", logId: log.id }, { status: 502 });
  return NextResponse.json({ sent: true, logId: log.id, supplier: supplier.supplierName, recipient: supplier.to.join(";"), cc, partCount: supplier.partCount, attachmentName });
}
