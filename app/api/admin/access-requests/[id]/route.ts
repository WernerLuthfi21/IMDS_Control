import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid request id." }, { status: 400 });
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Only an admin can review access requests." }, { status: 403 });
  const body = await request.json().catch(() => null) as { action?: string; reviewNote?: string } | null;
  if (!body || !["approve", "reject"].includes(body.action || "")) return NextResponse.json({ error: "Choose approve or reject." }, { status: 422 });
  const { data: accessRequest } = await supabase.from("access_requests").select("*").eq("id", id).maybeSingle();
  if (!accessRequest) return NextResponse.json({ error: "Request not found." }, { status: 404 });
  if (accessRequest.status !== "PENDING") return NextResponse.json({ error: "This request has already been reviewed." }, { status: 409 });

  if (body.action === "reject") {
    const { error } = await supabase.from("access_requests").update({
      status: "REJECTED", reviewed_by: auth.user.id, reviewed_at: new Date().toISOString(),
      review_note: String(body.reviewNote || "").trim().slice(0, 1000) || null
    }).eq("id", id).eq("status", "PENDING");
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    await supabase.from("audit_events").insert({ actor_id: auth.user.id, action: "ACCESS_REQUEST_REJECTED", entity_type: "access_request", entity_id: id });
    return NextResponse.json({ status: "REJECTED" });
  }

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Account provisioning is not configured. Set SUPABASE_SERVICE_ROLE_KEY on the server first." }, { status: 503 });

  let userId: string | null = null;
  const { data: existing } = await admin.from("profiles").select("id,role").eq("email", accessRequest.target_email).maybeSingle();
  if (existing?.id) {
    userId = existing.id;
  } else {
    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(accessRequest.target_email, {
      data: { display_name: accessRequest.target_name, company_name: accessRequest.company_name },
      redirectTo: new URL("/reset-password", request.url).toString()
    });
    if (inviteError || !invited.user) return NextResponse.json({ error: inviteError?.message || "The invitation could not be sent. Check Supabase Auth email configuration." }, { status: 502 });
    userId = invited.user.id;
  }

  const patch: Record<string, unknown> = { role: accessRequest.requested_role, display_name: accessRequest.target_name };
  if (accessRequest.request_type === "SUPPLIER") patch.supplier_code = accessRequest.supplier_code || null;
  const { error: profileError } = await admin.from("profiles").update(patch).eq("id", userId);
  if (profileError) return NextResponse.json({ error: "The account invitation was sent, but the profile role update failed. Admin intervention is required." }, { status: 500 });

  const { error: reviewError } = await supabase.from("access_requests").update({
    status: "APPROVED", reviewed_by: auth.user.id, reviewed_at: new Date().toISOString(),
    review_note: String(body.reviewNote || "").trim().slice(0, 1000) || null,
    provisioned_user_id: userId
  }).eq("id", id).eq("status", "PENDING");
  if (reviewError) return NextResponse.json({ error: "Account was provisioned but the request record could not be finalized. Refresh and reconcile this request." }, { status: 500 });
  await supabase.from("audit_events").insert({ actor_id: auth.user.id, action: "ACCESS_REQUEST_APPROVED", entity_type: "access_request", entity_id: id, metadata: { provisioned_user_id: userId, assigned_role: accessRequest.requested_role } });
  return NextResponse.json({ status: "APPROVED", userId, inviteSent: !existing?.id });
}
