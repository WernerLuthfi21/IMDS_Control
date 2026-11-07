import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { canAccessImdsTracker } from "@/lib/security/imds-tracker";
import { postToFlow } from "@/lib/automation/flow";
import { buildSupplierReportPdf } from "@/lib/imds-master/report-pdf";

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
};

function emails(value: unknown): string[] {
  return [...new Set(String(value ?? "").split(/[;,\s]+/).map((item) => item.trim()).filter((item) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(item)))];
}

function outstanding(status: unknown): boolean {
  const value = String(status ?? "").trim().toLowerCase();
  if (!value) return true;
  if (/rejected|dead|not\s*(yet\s*)?submitted|not\s*submit|not\s*yet|pending|outstanding|working|in\s*process/.test(value)) return true;
  return !/submitted|accepted|approved|complete|cleared/.test(value);
}

function supplierKey(part: MasterPart) {
  return `${String(part.vendor_code || "").trim().toUpperCase()}|${String(part.company_name || "").trim().toUpperCase()}`;
}

async function loadSupplierGroups(supabase: NonNullable<Awaited<ReturnType<typeof createClient>>>) {
  const parts: MasterPart[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await supabase.from("imds_master_parts")
      .select("id,master_key,project,vendor_code,main_pic_email,company_name,part_name,part_no,submission_plan,supplier_promise_date,imds_status,imds_id_version,md_id_version,status_update,md_status_update_date,comment,md_system_records")
      .order("company_name").order("part_no").range(from, from + 999);
    if (error) throw new Error(error.message);
    parts.push(...(data || []) as MasterPart[]);
    if (!data || data.length < 1000) break;
  }

  const { data: contacts, error: contactsError } = await supabase.from("supplier_contacts")
    .select("supplier_code,supplier_name,email,contact_role,active")
    .eq("active", true)
    .limit(10000);
  if (contactsError) throw new Error(contactsError.message);

  const grouped = new Map<string, MasterPart[]>();
  for (const part of parts) {
    if (!outstanding(part.imds_status)) continue;
    const key = supplierKey(part);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(part);
  }

  const suppliers = [];
  for (const group of grouped.values()) {
    const first = group[0];
    const code = String(first.vendor_code || "");
    const company = String(first.company_name || "Unknown supplier");
    const contactRows = (contacts || []).filter((contact) =>
      String(contact.supplier_code || "").trim().toUpperCase() === code.trim().toUpperCase()
    );
    const picRows = contactRows.filter((contact) => {
      const role = String(contact.contact_role || "").toUpperCase();
      return role === "PIC" || (role.includes("PIC") && !role.includes("SPV"));
    });
    const fallback = group.flatMap((part) => emails(part.main_pic_email));
    const to = [...new Set((picRows.length ? picRows.flatMap((contact) => emails(contact.email)) : fallback))];
    const cc = [...new Set(contactRows.filter((contact) => {
      const role = String(contact.contact_role || "").toUpperCase();
      return role.includes("CC") || role.includes("SPV") || role.includes("MARKETING");
    }).flatMap((contact) => emails(contact.email)))];
    const projects = [...new Set(group.map((part) => String(part.project || "").trim()).filter(Boolean))].sort();
    const subject = `IMDS submission follow-up | ${company} | ${group.length} outstanding part(s)`;
    const partRows = group.map((part, index) => ({
      id: part.id,
      project: part.project,
      part_no: part.part_no,
      part_name: part.part_name,
      imds_status: part.imds_status,
      submission_plan: part.supplier_promise_date || part.submission_plan,
      imds_id_version: part.imds_id_version,
      md_id_version: part.md_id_version,
      status_update: part.status_update,
      md_status_update_date: part.md_status_update_date,
      comment: part.comment,
      sequence: index + 1
    }));
    const body = [
      `Dear ${company} Team,`,
      "",
      "We would appreciate your support to review the latest IMDS submission status for the following outstanding parts.",
      `Supplier code: ${code || "-"}`,
      `Project(s): ${projects.join(", ") || "-"}`,
      `Outstanding parts: ${group.length}`,
      "",
      "PART LIST",
      ...partRows.map((part) => `${part.sequence}. ${part.project || "-"} | ${part.part_no || "-"} | ${part.part_name || "-"} | ${part.imds_status || "-"} | MD System: ${part.status_update || "-"} | Plan: ${part.submission_plan || "Not provided"}`),
      "",
      "Please confirm the latest IMDS status and provide a committed submission plan/date for each outstanding part. The supplier-specific PDF report is attached for your reference.",
      "",
      "Thank you for your support and cooperation.",
      "",
      "Best regards,",
      "IMDS / G-CATS Team"
    ].join("\n");
    suppliers.push({
      supplierCode: code,
      supplierName: company,
      to,
      cc,
      subject,
      body,
      partCount: group.length,
      projects,
      parts: partRows,
      emailReady: to.length > 0
    });
  }
  return suppliers.sort((a, b) => b.partCount - a.partCount || a.supplierName.localeCompare(b.supplierName));
}

export async function GET() {
  const auth = await getAuthContext();
  if (!auth.configured) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  if (!auth.userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!canAccessImdsTracker(auth.role)) return NextResponse.json({ error: "Internal workspace access required." }, { status: 403 });
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });

  try {
    const suppliers = await loadSupplierGroups(supabase);
    return NextResponse.json({
      suppliers,
      configured: Boolean(process.env.POWER_AUTOMATE_EMAIL_URL?.trim() && process.env.POWER_AUTOMATE_SECRET?.trim()),
      sendMode: "one supplier per request; sequential sending is controlled by the website"
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not prepare supplier follow-ups." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await getAuthContext();
  if (!auth.configured) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  if (!auth.userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!["admin", "preparer", "reviewer"].includes(auth.role || "")) {
    return NextResponse.json({ error: "Admin, preparer or reviewer role is required to send supplier follow-ups." }, { status: 403 });
  }
  const body = await request.json().catch(() => null) as { supplierCode?: string; supplierName?: string; subject?: string; messageBody?: string } | null;
  if (!body?.supplierName) return NextResponse.json({ error: "Choose one supplier to follow up." }, { status: 400 });

  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  let suppliers;
  try { suppliers = await loadSupplierGroups(supabase); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load supplier parts." }, { status: 500 }); }

  const supplier = suppliers.find((item) =>
    item.supplierName === body.supplierName && item.supplierCode === (body.supplierCode || "")
  );
  if (!supplier) return NextResponse.json({ error: "This supplier no longer has outstanding parts in the shared master." }, { status: 404 });
  if (!supplier.to.length) return NextResponse.json({ error: "No valid supplier PIC email is registered. Update the supplier contact directory first." }, { status: 422 });

  const emailUrl = process.env.POWER_AUTOMATE_EMAIL_URL?.trim();
  const flowSecret = process.env.POWER_AUTOMATE_SECRET?.trim() || null;
  if (!emailUrl || !/^https:\/\//i.test(emailUrl) || !flowSecret) {
    return NextResponse.json({ error: "POWER_AUTOMATE_EMAIL_URL and POWER_AUTOMATE_SECRET must both be configured. The message was not sent.", prepared: true }, { status: 503 });
  }

  const subject = String(body.subject || supplier.subject).trim().slice(0, 240);
  const messageBody = String(body.messageBody || supplier.body).trim().slice(0, 30000);
  const dateTag = new Date().toISOString().slice(0, 10);
  const attachmentName = `IMDS_Outstanding_${supplier.supplierCode || "SUPPLIER"}_${dateTag}.pdf`;
  const pdf = buildSupplierReportPdf(supplier.supplierName, supplier.supplierCode, supplier.parts);
  const { data: log, error: logError } = await supabase.from("imds_tracker_followup_logs").insert({
    supplier_code: supplier.supplierCode || null,
    supplier_name: supplier.supplierName,
    recipient_email: supplier.to.join(";"),
    cc_emails: supplier.cc,
    subject,
    message_body: messageBody,
    part_count: supplier.partCount,
    attachment_name: attachmentName,
    status: "PREPARED",
    sent_by: auth.userId
  }).select("id").single();
  if (logError || !log) return NextResponse.json({ error: logError?.message || "Could not record follow-up attempt." }, { status: 500 });

  const delivery = await postToFlow(emailUrl, flowSecret, {
    type: "supplier_email",
    supplierCode: supplier.supplierCode,
    supplierName: supplier.supplierName,
    to: supplier.to.join(";"),
    cc: supplier.cc.join(";"),
    subject,
    body: messageBody,
    attachments: [{ name: attachmentName, contentType: "application/pdf", contentBytes: pdf.toString("base64") }],
    metadata: { source: "IMDS Super Master", partCount: supplier.partCount, projects: supplier.projects, logId: log.id }
  });

  const status = delivery.ok ? "SENT" : "FAILED";
  await supabase.from("imds_tracker_followup_logs").update({
    status,
    sent_at: delivery.ok ? new Date().toISOString() : null,
    error_message: delivery.error || null,
    provider_response: { httpStatus: delivery.status, ok: delivery.ok }
  }).eq("id", log.id);
  await supabase.from("audit_events").insert({
    actor_id: auth.userId,
    action: delivery.ok ? "IMDS_TRACKER_SUPPLIER_EMAIL_SENT" : "IMDS_TRACKER_SUPPLIER_EMAIL_FAILED",
    entity_type: "imds_tracker_followup",
    entity_id: log.id,
    metadata: { supplierCode: supplier.supplierCode, recipientCount: supplier.to.length, parts: supplier.partCount, status }
  });

  if (!delivery.ok) return NextResponse.json({ error: delivery.error || "Power Automate did not accept this supplier e-mail.", logId: log.id }, { status: 502 });
  return NextResponse.json({
    sent: true,
    logId: log.id,
    supplier: supplier.supplierName,
    recipient: supplier.to.join(";"),
    partCount: supplier.partCount,
    attachmentName
  });
}
