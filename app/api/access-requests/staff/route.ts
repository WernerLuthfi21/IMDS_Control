import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendAccessApprovalNotice } from "@/lib/access/mail";

export const runtime = "nodejs";
const INTERNAL = ["admin", "preparer", "reviewer", "viewer", "rule_author", "rule_approver"];
const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role,display_name").eq("id", auth.user.id).maybeSingle();
  if (!profile || !INTERNAL.includes(profile.role)) return NextResponse.json({ error: "Only TMMIN staff accounts can submit an internal account request." }, { status: 403 });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || body.website) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const targetName = clean(body.fullName, 100);
  const targetEmail = clean(body.email, 254).toLowerCase();
  const company = clean(body.department || body.company || "TMMIN", 120);
  const note = String(body.note ?? "").trim().slice(0, 1000);
  if (targetName.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) return NextResponse.json({ error: "Please provide the staff member's full name and work email." }, { status: 422 });
  if (targetEmail === (auth.user.email || "").toLowerCase()) return NextResponse.json({ error: "Use this account's existing access instead of registering yourself again." }, { status: 422 });

  const { data, error } = await supabase.from("access_requests").insert({
    request_type: "TMMIN_STAFF",
    requester_id: auth.user.id,
    requester_name: profile.display_name || auth.user.email || "TMMIN staff",
    requester_email: auth.user.email || "",
    company_name: company,
    target_name: targetName,
    target_email: targetEmail,
    requested_role: "viewer",
    note: note || null
  }).select("id").single();
  if (error || !data) {
    const duplicate = (error?.message || "").toLowerCase().includes("duplicate") || error?.code === "23505";
    return NextResponse.json({ error: duplicate ? "A pending request already exists for this email." : "The request could not be registered." }, { status: duplicate ? 409 : 400 });
  }

  const admin = createAdminClient();
  let recipients: string[] = [];
  if (admin) {
    const { data: rows } = await admin.from("access_approval_recipients").select("email").eq("active", true);
    recipients = (rows || []).map((row) => row.email);
  }
  if (!recipients.length && process.env.NEXT_PUBLIC_ACCESS_REQUEST_EMAIL) recipients = [process.env.NEXT_PUBLIC_ACCESS_REQUEST_EMAIL];
  const approvalUrl = new URL("/access-management", request.url).toString();
  const mail = await sendAccessApprovalNotice(recipients, "IMDS Workspace · TMMIN staff access request", [
    "A TMMIN staff account request is awaiting administrator approval.",
    "",
    "Requested account: " + targetName + " (" + targetEmail + ")",
    "Department / company: " + company,
    "Requested by: " + (profile.display_name || auth.user.email || "TMMIN staff"),
    "Requester email: " + (auth.user.email || "—"),
    "Note: " + (note || "—"),
    "",
    "Review request: " + approvalUrl,
    "",
    "The requested account has not been activated."
  ].join("\n"));
  return NextResponse.json({ ok: true, requestId: data.id, notification: mail.configured ? (mail.failed ? "PARTIAL" : "SENT") : "NOT_CONFIGURED" }, { status: 201 });
}
