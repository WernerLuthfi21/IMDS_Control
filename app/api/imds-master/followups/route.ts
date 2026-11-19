import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { canAccessImdsTracker } from "@/lib/security/imds-tracker";
import { postToFlow } from "@/lib/automation/flow";
import { emailsOf } from "@/lib/followup/recipients";
import { buildSupplierEmailPayload, parseSenders, pickSender, MAX_ATTACHMENT_BYTES, type Attachment } from "@/lib/followup/payload";
import { gapHoursFromEnv, recentlySent } from "@/lib/followup/guard";
import { buildSupplierReportPdf } from "@/lib/imds-master/report-pdf";
import { buildUnsubmittedXlsx, type XlsxPart } from "@/lib/imds-master/report-xlsx";
import { DEFAULT_CONFIG, KINDS, mergeCc, sanitizeConfig, signOff, type Kind } from "@/lib/followup/center";
import { buildEml, emlFileName } from "@/lib/followup/eml";

export const runtime = "nodejs";
export const maxDuration = 60;

type Db = NonNullable<Awaited<ReturnType<typeof createClient>>>;

async function loadConfig(supabase: Db) {
  const { data } = await supabase.from("imds_tracker_settings").select("value").eq("key", "followup_config").maybeSingle();
  return sanitizeConfig(data?.value ?? DEFAULT_CONFIG);
}

/** What the page needs to know: can we send, as whom, and who was e-mailed recently. Rendering and recipients are decided in the browser. */
export async function GET() {
  const auth = await getAuthContext();
  if (!auth.configured) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  if (!auth.userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!canAccessImdsTracker(auth.role)) return NextResponse.json({ error: "Internal workspace access required." }, { status: 403 });
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const since = new Date(Date.now() - 60 * 86400000).toISOString();
  const { data } = await supabase.from("imds_tracker_followup_logs").select("supplier_name,sent_at").eq("status", "SENT").gte("sent_at", since).order("sent_at", { ascending: false }).limit(3000);
  const lastSent: Record<string, string> = {};
  for (const row of data || []) if (row.supplier_name && row.sent_at && !lastSent[row.supplier_name]) lastSent[row.supplier_name] = row.sent_at;
  const hasUrl = /^https:\/\//i.test(process.env.POWER_AUTOMATE_EMAIL_URL?.trim() || ""), hasSecret = Boolean(process.env.POWER_AUTOMATE_SECRET?.trim());
  return NextResponse.json({
    configured: hasUrl && hasSecret,
    setup: { url: hasUrl, secret: hasSecret, senders: parseSenders(process.env.FOLLOWUP_SENDERS).length },
    me: auth.email,
    senders: parseSenders(process.env.FOLLOWUP_SENDERS),
    canSend: ["admin", "preparer", "reviewer"].includes(auth.role || ""),
    canDraft: canAccessImdsTracker(auth.role),
    role: auth.role,
    canConfigure: ["admin", "preparer"].includes(auth.role || ""),
    gapHours: gapHoursFromEnv(process.env.FOLLOWUP_MIN_GAP_HOURS),
    lastSent
  }, { headers: { "Cache-Control": "private, no-store" } });
}

type SendBody = {
  kind?: string; supplierCode?: string; supplierName?: string; to?: string[]; cc?: string[]; subject?: string; messageBody?: string;
  sender?: string; force?: boolean; partIds?: string[]; attachments?: { pdf?: boolean; xlsx?: boolean };
  /** A PDF built in the browser (the executive summary for the recap). */
  extraPdf?: { name?: string; base64?: string };
  /** The supplier PDF exactly as the Tracker's "Supplier PDF" button makes it (built in the browser). */
  supplierPdf?: { name?: string; base64?: string };
  /** Test send: goes only to `testTo`, no mandatory CC, no recently-sent guard, subject marked [TEST]. */
  test?: boolean; testTo?: string;
  /** "draft": return an Outlook draft (.eml) for the user's own mailbox instead of sending through Power Automate. */
  mode?: "send" | "draft";
};

const RECAP_NAME = "ALL SUPPLIERS (RECAP)";

export async function POST(request: NextRequest) {
  const auth = await getAuthContext();
  if (!auth.configured) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  if (!auth.userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const body = await request.json().catch(() => null) as SendBody | null;
  // Outlook drafts send nothing, so every internal colleague may prepare them; sending needs an editor role.
  const draftOnly = body?.mode === "draft";
  if (!["admin", "preparer", "reviewer"].includes(auth.role || "") && !(draftOnly && canAccessImdsTracker(auth.role))) {
    return NextResponse.json({ error: "Sending supplier e-mails needs the preparer, reviewer or admin role. Use “📨 Outlook drafts”, or ask an admin for the role in Settings → Team access." }, { status: 403 });
  }
  const kind = (KINDS as readonly string[]).includes(String(body?.kind)) ? (body!.kind as Kind) : null;
  if (!body || !kind) return NextResponse.json({ error: "Choose the kind of e-mail (request, follow-up or recap)." }, { status: 400 });
  const recap = kind === "recap";
  const supplierName = recap ? RECAP_NAME : String(body.supplierName || "").trim();
  if (!supplierName) return NextResponse.json({ error: "Choose one supplier." }, { status: 400 });
  const test = body.test === true;
  const draft = body.mode === "draft";
  const senders = parseSenders(process.env.FOLLOWUP_SENDERS);
  let to = emailsOf((body.to || []).join(";")).slice(0, recap ? 400 : 20);
  if (test) {
    // A test may only reach the person who is testing (or their own organisation), never a supplier.
    const target = emailsOf(String(body.testTo || auth.email || ""))[0];
    const domains = new Set([auth.email, ...senders.map((x) => x.email)].filter(Boolean).map((x) => String(x).split("@")[1]?.toLowerCase()));
    if (!target) return NextResponse.json({ error: "Enter a valid test e-mail address." }, { status: 422 });
    if (!domains.has(target.split("@")[1]?.toLowerCase())) return NextResponse.json({ error: "A test can only be sent to an address in your own organisation." }, { status: 422 });
    to = [target];
  }
  if (!to.length) return NextResponse.json({ error: "No valid recipient e-mail. Add the supplier PIC in Directory first." }, { status: 422 });
  let subject = String(body.subject || "").trim().slice(0, 240);
  if (test && !/^\[TEST\]/i.test(subject)) subject = `[TEST] ${subject}`.slice(0, 240);
  const rawBody = String(body.messageBody || "").trim().slice(0, 30000);
  if (!subject || !rawBody) return NextResponse.json({ error: "Subject and message are required." }, { status: 422 });

  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const config = await loadConfig(supabase);
  const sender = pickSender(senders, body.sender);   // not on the allow-list => the flow's own mailbox sends
  // The page already adds the sign-off; this only covers an older cached page. Never added twice.
  const messageBody = signOff(rawBody, config, sender?.name);
  const cc = test ? [] : mergeCc({ to, cc: emailsOf((body.cc || []).join(";")), required: config.requiredCc, senderEmail: draft ? auth.email || undefined : sender?.email });

  const gapHours = gapHoursFromEnv(process.env.FOLLOWUP_MIN_GAP_HOURS);
  if (!draft && !test && !body.force && gapHours > 0) {
    const { data: last } = await supabase.from("imds_tracker_followup_logs").select("sent_at").eq("supplier_name", supplierName).eq("status", "SENT").order("sent_at", { ascending: false }).limit(1);
    if (recentlySent(last?.[0]?.sent_at, new Date(), gapHours)) {
      return NextResponse.json({ error: `${supplierName} was already e-mailed within the last ${gapHours} hours. Nothing was sent.`, skipped: "RECENTLY_SENT" }, { status: 409 });
    }
  }
  const emailUrl = process.env.POWER_AUTOMATE_EMAIL_URL?.trim();
  const flowSecret = process.env.POWER_AUTOMATE_SECRET?.trim() || null;
  if (!draft && (!emailUrl || !/^https:\/\//i.test(emailUrl) || !flowSecret)) {
    return NextResponse.json({ error: "POWER_AUTOMATE_EMAIL_URL and POWER_AUTOMATE_SECRET must both be configured. Nothing was sent.", notConfigured: true }, { status: 503 });
  }

  // Attachments describe exactly the parts listed in the e-mail: the browser sends their ids, the server reads them from the shared master.
  const ids = [...new Set((body.partIds || []).map(String))].slice(0, 6000);
  const parts: (XlsxPart & { vendor_code?: string | null })[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await supabase.from("imds_master_parts")
      .select("company_name,vendor_code,project,part_no,part_name,imds_status,imds_id_version,md_id_version,md_status_update_date,submission_plan,supplier_promise_date,comment")
      .in("id", ids.slice(i, i + 150));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    parts.push(...((data || []) as (XlsxPart & { vendor_code?: string | null; supplier_promise_date?: string | null })[]).map((p) => ({ ...p, submission_plan: (p as { supplier_promise_date?: string | null }).supplier_promise_date || p.submission_plan })));
  }
  const supplierCode = recap ? "" : String(body.supplierCode || parts[0]?.vendor_code || "");
  const dateTag = new Date().toISOString().slice(0, 10);
  const stem = recap ? `IMDS_Outstanding_ALL_${dateTag}` : `IMDS_Outstanding_${supplierCode || "SUPPLIER"}_${dateTag}`;
  const attachments: Attachment[] = [];
  const wantPdf = body.attachments?.pdf ?? config.attachments.pdf, wantXlsx = body.attachments?.xlsx ?? config.attachments.xlsx;
  // Prefer the PDF the Tracker itself draws (same layout as the "Supplier PDF" button). The server-built text
  // PDF is only a fallback for callers that do not send one.
  const browserPdf = !recap && wantPdf && body.supplierPdf?.base64 ? Buffer.from(String(body.supplierPdf.base64), "base64") : null;
  if (browserPdf) {
    if (browserPdf.length < 100 || browserPdf.subarray(0, 4).toString("latin1") !== "%PDF") return NextResponse.json({ error: "The supplier PDF from the Tracker is not a valid PDF. Nothing was sent." }, { status: 422 });
    if (browserPdf.length > MAX_ATTACHMENT_BYTES) return NextResponse.json({ error: "The supplier PDF is larger than 10 MB. Nothing was sent." }, { status: 413 });
    attachments.push({ name: `${stem}.pdf`, contentType: "application/pdf", contentBytes: browserPdf.toString("base64") });
  } else if (!recap && wantPdf && parts.length) attachments.push({ name: `${stem}.pdf`, contentType: "application/pdf", contentBytes: buildSupplierReportPdf(supplierName, supplierCode, parts).toString("base64") });
  if (wantXlsx && parts.length) attachments.push({ name: `${stem}.xlsx`, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", contentBytes: (await buildUnsubmittedXlsx(recap ? "ALL SUPPLIERS" : supplierName, supplierCode, parts)).toString("base64") });
  if (recap && body.extraPdf?.base64) {
    const bytes = Buffer.from(String(body.extraPdf.base64), "base64");
    if (bytes.length < 100 || bytes.subarray(0, 4).toString("latin1") !== "%PDF") return NextResponse.json({ error: "The recap PDF is not a valid PDF. Nothing was sent." }, { status: 422 });
    if (bytes.length > MAX_ATTACHMENT_BYTES) return NextResponse.json({ error: "The recap PDF is larger than 10 MB. Nothing was sent." }, { status: 413 });
    attachments.push({ name: String(body.extraPdf.name || "IMDS_Submission_Summary.pdf").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80), contentType: "application/pdf", contentBytes: bytes.toString("base64") });
  }

  if (draft) {
    const eml = buildEml({ to, cc, subject, body: messageBody, attachments });
    const totalBytes = Buffer.byteLength(eml);
    if (totalBytes > 4_000_000) return NextResponse.json({ error: "This draft is larger than 4 MB. Untick the PDF or Excel attachment and try again." }, { status: 413 });
    const { data: dlog } = await supabase.from("imds_tracker_followup_logs").insert({
      supplier_code: supplierCode || null, supplier_name: test ? `[TEST] ${supplierName}` : supplierName, recipient_email: to.join(";"), cc_emails: cc, subject, message_body: messageBody,
      part_count: ids.length, attachment_name: attachments.map((a) => a.name).join(", ") || null, status: "PREPARED", sent_by: auth.userId
    }).select("id").single();
    await supabase.from("audit_events").insert({ actor_id: auth.userId, action: "IMDS_TRACKER_SUPPLIER_EMAIL_DRAFTED", entity_type: "imds_tracker_followup", entity_id: dlog?.id ?? null,
      metadata: { kind, supplierCode, recipientCount: to.length, ccCount: cc.length, parts: ids.length, attachments: attachments.map((a) => a.name) } });
    return NextResponse.json({ draft: true, fileName: emlFileName(supplierName), eml: Buffer.from(eml, "utf8").toString("base64"), to, cc, attachments: attachments.map((a) => a.name) });
  }

  const { data: log, error: logError } = await supabase.from("imds_tracker_followup_logs").insert({
    supplier_code: supplierCode || null, supplier_name: test ? `[TEST] ${supplierName}` : supplierName, recipient_email: to.join(";"), cc_emails: cc, subject, message_body: messageBody,
    part_count: ids.length, attachment_name: attachments.map((a) => a.name).join(", ") || null, status: "PREPARED", sent_by: auth.userId
  }).select("id").single();
  if (logError || !log) return NextResponse.json({ error: logError?.message || "Could not record the e-mail attempt." }, { status: 500 });

  let payload;
  try {
    payload = buildSupplierEmailPayload({
      source: "tracker", followupId: log.id, logId: log.id, supplierCode, supplierName, to, cc, sender, subject, body: messageBody, attachments,
      metadata: { partCount: ids.length, projects: [...new Set(parts.map((p) => String(p.project || "")).filter(Boolean))].sort(), items: ids.length }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not prepare the e-mail.";
    await supabase.from("imds_tracker_followup_logs").update({ status: "FAILED", error_message: message }).eq("id", log.id);
    return NextResponse.json({ error: message, logId: log.id }, { status: 422 });
  }
  const delivery = await postToFlow(emailUrl as string, flowSecret, payload);
  const status = delivery.ok ? "SENT" : "FAILED";
  await supabase.from("imds_tracker_followup_logs").update({
    status, sent_at: delivery.ok ? new Date().toISOString() : null, error_message: delivery.error || (delivery.handedOff ? "Accepted by the flow (HTTP 202); check the flow run history for the actual send." : null), provider_response: { httpStatus: delivery.status, ok: delivery.ok, handedOff: Boolean(delivery.handedOff) }
  }).eq("id", log.id);
  await supabase.from("audit_events").insert({
    actor_id: auth.userId, action: delivery.ok ? "IMDS_TRACKER_SUPPLIER_EMAIL_SENT" : "IMDS_TRACKER_SUPPLIER_EMAIL_FAILED", entity_type: "imds_tracker_followup", entity_id: log.id,
    metadata: { kind, test, supplierCode, recipientCount: to.length, ccCount: cc.length, parts: ids.length, attachments: attachments.map((a) => a.name), status }
  });
  if (!delivery.ok) return NextResponse.json({ error: delivery.error || "Power Automate did not accept this e-mail.", logId: log.id }, { status: 502 });
  return NextResponse.json({ sent: true, handedOff: Boolean(delivery.handedOff), logId: log.id, supplier: supplierName, to, cc, partCount: ids.length, attachments: attachments.map((a) => a.name), test, sentFrom: sender?.email || "the flow's own mailbox" });
}
