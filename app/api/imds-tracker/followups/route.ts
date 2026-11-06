import { NextRequest, NextResponse } from "next/server";
import { trackerAuth } from "@/lib/imds-tracker/auth";
import { buildSupplierReportPdf } from "@/lib/imds-tracker/report-pdf";
import { uniqueEmails } from "@/lib/imds-tracker/utils";
import { postToFlow } from "@/lib/automation/flow";

export const runtime = "nodejs";
export const maxDuration = 60;

type Part = Record<string, unknown> & { id: string; company_name: string | null; vendor_code: string | null; main_pic_email: string | null; project: string | null; part_no: string | null; part_name: string | null; imds_status: string | null; submission_plan: string | null; imds_id_version: string | null };

async function loadGroups(supabase: NonNullable<Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>>) {
  const parts: Part[] = [];
  for (let from = 0; from < 10000; from += 1000) {
    const { data, error } = await supabase.from("imds_master_parts").select("*").order("company_name").order("part_no").range(from, from + 999);
    if (error) throw new Error(error.message);
    parts.push(...(data || []) as Part[]);
    if ((data || []).length < 1000) break;
  }
  const { data: contacts, error: contactError } = await supabase.from("supplier_contacts")
    .select("supplier_code,supplier_name,contact_name,email,contact_role,active").eq("active", true).limit(5000);
  if (contactError) throw new Error(contactError.message);

  const grouped = new Map<string, Part[]>();
  for (const part of parts) {
    const status = String(part.imds_status || "").toUpperCase();
    if (!status.includes("NOT SUBMITTED") && !status.includes("REJECTED") && !status.includes("DEAD")) continue;
    const key = `${String(part.vendor_code || "").trim().toUpperCase()}|${String(part.company_name || "").trim().toUpperCase()}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(part);
  }

  const result = [];
  for (const group of grouped.values()) {
    const first = group[0];
    const code = String(first.vendor_code || "");
    const company = String(first.company_name || "Unknown supplier");
    const supplierContacts = (contacts || []).filter((c) => String(c.supplier_code || "").toUpperCase() === code.toUpperCase());
    const pic = supplierContacts.filter((c) => String(c.contact_role || "").toUpperCase().includes("PIC") && !String(c.contact_role || "").toUpperCase().includes("SPV")).map((c) => c.email);
    const fallbackPic = group.flatMap((p) => uniqueEmails(p.main_pic_email));
    const to = uniqueEmails(pic.length ? pic : fallbackPic);
    const cc = uniqueEmails(supplierContacts.filter((c) => !String(c.contact_role || "").toUpperCase().includes("PIC") || String(c.contact_role || "").toUpperCase().includes("SPV")).map((c) => c.email).join(";"));
    const projects = [...new Set(group.map((p) => String(p.project || "")).filter(Boolean))].sort();
    const subject = `IMDS submission follow-up | ${company} | ${group.length} outstanding part(s)`;
    const lines = group.map((p, i) => {
      const plan = p.supplier_promise_date || p.submission_plan || "Not provided";
      return `${i + 1}. ${p.project || "-"} | ${p.part_no || "-"} | ${p.part_name || "-"} | ${p.imds_status || "-"} | Plan: ${plan}`;
    });
    const body = [
      `Dear ${company} Team,`,
      "",
      "We would appreciate your support to review the latest IMDS submission status for the following outstanding parts.",
      `Supplier code: ${code || "-"}`,
      `Project(s): ${projects.join(", ") || "-"}`,
      `Outstanding parts: ${group.length}`,
      "",
      "PART LIST",
      ...lines,
      "",
      "Please confirm the current IMDS status and provide a committed submission plan/date for each outstanding part. The supplier-specific PDF report is attached for your reference.",
      "",
      "Thank you for your support and cooperation.",
      "",
      "Best regards,",
      "IMDS / G-CATS Team"
    ].join("\n");
    result.push({
      supplierCode: code, supplierName: company, to, cc, subject, body, partCount: group.length,
      projects, parts: group.map((p) => ({ id: p.id, project: p.project, part_no: p.part_no, part_name: p.part_name, imds_status: p.imds_status, submission_plan: p.supplier_promise_date || p.submission_plan, imds_id_version: p.imds_id_version })),
      emailReady: to.length > 0
    });
  }
  return result.sort((a, b) => b.partCount - a.partCount || a.supplierName.localeCompare(b.supplierName));
}

export async function GET() {
  const ctx = await trackerAuth(["admin", "preparer", "reviewer", "viewer"]);
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  try {
    const suppliers = await loadGroups(ctx.supabase);
    return NextResponse.json({
      suppliers,
      configured: Boolean(process.env.POWER_AUTOMATE_EMAIL_URL?.trim()),
      sendMode: "one supplier per action; no bulk blast"
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not prepare supplier groups." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const ctx = await trackerAuth(["admin", "preparer", "reviewer"]);
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  const body = await request.json().catch(() => null) as { supplierCode?: string; supplierName?: string; subject?: string; messageBody?: string } | null;
  if (!body?.supplierName) return NextResponse.json({ error: "Choose one supplier to follow up." }, { status: 400 });
  let suppliers;
  try { suppliers = await loadGroups(ctx.supabase); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load supplier parts." }, { status: 500 }); }
  const target = suppliers.find((s) => s.supplierName === body.supplierName && s.supplierCode === (body.supplierCode || ""));
  if (!target) return NextResponse.json({ error: "This supplier no longer has outstanding parts in the master." }, { status: 404 });
  if (!target.to.length) return NextResponse.json({ error: "No valid supplier PIC email is registered. Add or correct the PIC in the supplier directory before sending." }, { status: 422 });
  const emailUrl = process.env.POWER_AUTOMATE_EMAIL_URL?.trim();
  const secret = process.env.POWER_AUTOMATE_SECRET?.trim() || null;
  const subject = String(body.subject || target.subject).trim();
  const message = String(body.messageBody || target.body).trim();
  const dateTag = new Date().toISOString().slice(0, 10);
  const attachmentName = `IMDS_Outstanding_${target.supplierCode || "SUPPLIER"}_${dateTag}.pdf`;
  const pdf = buildSupplierReportPdf(target.supplierName, target.supplierCode, target.parts);
  const { data: log, error: logError } = await ctx.supabase.from("imds_tracker_followup_logs").insert({
    supplier_code: target.supplierCode || null, supplier_name: target.supplierName, recipient_email: target.to.join(";"),
    cc_emails: target.cc, subject, message_body: message, part_count: target.partCount, attachment_name: attachmentName,
    status: "PREPARED", sent_by: ctx.user.id
  }).select("id").single();
  if (logError || !log) return NextResponse.json({ error: logError?.message || "Could not record follow-up attempt." }, { status: 500 });

  if (!emailUrl || !/^https:\/\//i.test(emailUrl)) {
    const reason = "POWER_AUTOMATE_EMAIL_URL is not configured. The follow-up was prepared but not sent.";
    await ctx.supabase.from("imds_tracker_followup_logs").update({ status: "FAILED", error_message: reason }).eq("id", log.id);
    return NextResponse.json({ error: reason, logId: log.id, prepared: true }, { status: 503 });
  }

  const delivery = await postToFlow(emailUrl, secret, {
    type: "supplier_email",
    supplierCode: target.supplierCode,
    supplierName: target.supplierName,
    to: target.to.join(";"),
    cc: target.cc.join(";"),
    subject,
    body: message,
    attachments: [{ name: attachmentName, contentType: "application/pdf", contentBytes: pdf.toString("base64") }],
    metadata: { source: "IMDS Tracker", partCount: target.partCount, projects: target.projects }
  });
  const status = delivery.ok ? "SENT" : "FAILED";
  await ctx.supabase.from("imds_tracker_followup_logs").update({
    status, sent_at: delivery.ok ? new Date().toISOString() : null,
    error_message: delivery.error || null,
    provider_response: { httpStatus: delivery.status, ok: delivery.ok }
  }).eq("id", log.id);
  await ctx.supabase.from("audit_events").insert({
    actor_id: ctx.user.id, action: delivery.ok ? "IMDS_TRACKER_SUPPLIER_EMAIL_SENT" : "IMDS_TRACKER_SUPPLIER_EMAIL_FAILED",
    entity_type: "imds_tracker_followup", entity_id: log.id,
    metadata: { supplierCode: target.supplierCode, recipientCount: target.to.length, parts: target.partCount, status }
  });
  if (!delivery.ok) return NextResponse.json({ error: delivery.error || "Power Automate did not accept the email.", logId: log.id }, { status: 502 });
  return NextResponse.json({ sent: true, logId: log.id, supplier: target.supplierName, recipient: target.to.join(";"), partCount: target.partCount, attachmentName }, { status: 200 });
}
