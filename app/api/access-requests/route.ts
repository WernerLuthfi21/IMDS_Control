import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendAccessApprovalNotice } from "@/lib/access/mail";

export const runtime = "nodejs";
const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || body.website) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const fullName = clean(body.fullName, 100);
  const company = clean(body.company, 120);
  const email = clean(body.email, 254).toLowerCase();
  const supplierCode = clean(body.supplierCode, 20).toUpperCase();
  const note = String(body.note ?? "").trim().slice(0, 1000);
  if (fullName.length < 2 || company.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Please complete your name, company and a valid work email." }, { status: 422 });
  }
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Access requests are temporarily unavailable." }, { status: 503 });
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip") || "unknown";
  const { data, error } = await supabase.rpc("submit_supplier_access_request", {
    p_full_name: fullName,
    p_company: company,
    p_email: email,
    p_supplier_code: supplierCode || null,
    p_note: note || null,
    p_ip: ip
  });
  if (error) {
    const msg = error.message || "";
    if (msg.includes("REQUEST_ALREADY_PENDING")) return NextResponse.json({ error: "A request for this email is already awaiting administrator review." }, { status: 409 });
    if (msg.includes("RATE_LIMITED")) return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
    return NextResponse.json({ error: "The request could not be registered. Please check the details and try again." }, { status: 400 });
  }

  const admin = createAdminClient();
  let recipients: string[] = [];
  if (admin) {
    const { data: rows } = await admin.from("access_approval_recipients").select("email").eq("active", true);
    recipients = (rows || []).map((row) => row.email);
  }
  if (!recipients.length && process.env.NEXT_PUBLIC_ACCESS_REQUEST_EMAIL) recipients = [process.env.NEXT_PUBLIC_ACCESS_REQUEST_EMAIL];
  const approvalUrl = new URL("/access-management", request.url).toString();
  const mail = await sendAccessApprovalNotice(
    recipients,
    "IMDS Workspace · Supplier access request",
    [
      "A new supplier access request is awaiting administrator approval.",
      "",
      "Applicant: " + fullName,
      "Company: " + company,
      "Work email: " + email,
      "Supplier code: " + (supplierCode || "Not provided"),
      "Note: " + (note || "—"),
      "",
      "Review request: " + approvalUrl,
      "",
      "No account or role has been activated by this request."
    ].join("\n")
  );
  return NextResponse.json({ ok: true, requestId: data, notification: mail.configured ? (mail.failed ? "PARTIAL" : "SENT") : "NOT_CONFIGURED" }, { status: 201 });
}
