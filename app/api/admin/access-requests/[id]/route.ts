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
  const { needsMfaStepUp } = await import("@/lib/security/admin-mfa");
  if (await needsMfaStepUp(supabase)) return NextResponse.json({ error: "Admin approval requires a verified authenticator. Set it up in Settings, then sign in again before reviewing requests." }, { status: 403, headers: { "x-auth-reason": "mfa_required" } });
  const body = await request.json().catch(() => null) as { action?: string; reviewNote?: string } | null;
  if (!body || !["approve", "reject"].includes(body.action || "")) return NextResponse.json({ error: "Choose approve or reject." }, { status: 422 });
  const { data: accessRequest } = await supabase.from("access_requests").select("*").eq("id", id).maybeSingle();
  if (!accessRequest) return NextResponse.json({ error: "Request not found." }, { status: 404 });
  if (accessRequest.status !== "PENDING") return NextResponse.json({ error: "This request has already been reviewed." }, { status: 409 });

  if (body.action === "reject") {
    const { data: claimed, error: claimError } = await supabase.from("access_requests").update({ status: "PROCESSING" })
      .eq("id", id).eq("status", "PENDING").select("id").maybeSingle();
    if (claimError || !claimed) return NextResponse.json({ error: "Another administrator is processing this request, or it has already changed status." }, { status: 409 });
    const { error } = await supabase.from("access_requests").update({
      status: "REJECTED", reviewed_by: auth.user.id, reviewed_at: new Date().toISOString(),
      review_note: String(body.reviewNote || "").trim().slice(0, 1000) || null
    }).eq("id", id).eq("status", "PROCESSING");
    if (error) {
      await supabase.from("access_requests").update({ status: "PENDING" }).eq("id", id).eq("status", "PROCESSING");
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    await supabase.from("audit_events").insert({ actor_id: auth.user.id, action: "ACCESS_REQUEST_REJECTED", entity_type: "access_request", entity_id: id });
    return NextResponse.json({ status: "REJECTED" });
  }

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Account provisioning is not configured. Set SUPABASE_SERVICE_ROLE_KEY on the server first." }, { status: 503 });
  const { data: claimed, error: claimError } = await supabase.from("access_requests").update({ status: "PROCESSING" }).eq("id", id).eq("status", "PENDING").select("id").maybeSingle();
  if (claimError || !claimed) return NextResponse.json({ error: "Another administrator is already processing this request, or it has changed status." }, { status: 409 });

  let userId: string | null = null;
  const { data: existing } = await admin.from("profiles").select("id,role").eq("email", accessRequest.target_email).maybeSingle();
  if (existing?.id) {
    userId = existing.id;
  } else {
    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(accessRequest.target_email, {
      data: { display_name: accessRequest.target_name, company_name: accessRequest.company_name },
      redirectTo: new URL("/reset-password", request.url).toString()
    });
    if (inviteError || !invited.user) {
      await supabase.from("access_requests").update({ status: "PENDING" }).eq("id", id).eq("status", "PROCESSING");
      return NextResponse.json({ error: inviteError?.message || "The invitation could not be sent. Check Supabase Auth email configuration." }, { status: 502 });
    }
    userId = invited.user.id;
  }

  const elevatedRoles = ["admin", "preparer", "reviewer", "rule_author", "rule_approver"];
  const assignedRole = existing?.role && elevatedRoles.includes(existing.role) ? existing.role : accessRequest.requested_role;
  const patch: Record<string, unknown> = { role: assignedRole, display_name: accessRequest.target_name };
  if (accessRequest.request_type === "SUPPLIER") patch.supplier_code = accessRequest.supplier_code || null;
  const { error: profileError } = await admin.from("profiles").update(patch).eq("id", userId);
  if (profileError) {
    await supabase.from("access_requests").update({ status: "PENDING" }).eq("id", id).eq("status", "PROCESSING");
    return NextResponse.json({ error: "The account invitation was issued, but the profile role update failed. The request was returned to the queue for admin retry." }, { status: 500 });
  }

  const { error: reviewError } = await supabase.from("access_requests").update({
    status: "APPROVED", reviewed_by: auth.user.id, reviewed_at: new Date().toISOString(),
    review_note: String(body.reviewNote || "").trim().slice(0, 1000) || null,
    provisioned_user_id: userId
  }).eq("id", id).eq("status", "PROCESSING");
  if (reviewError) {
    await supabase.from("access_requests").update({ status: "PENDING" }).eq("id", id).eq("status", "PROCESSING");
    return NextResponse.json({ error: "Account was provisioned but the request record could not be finalized. It has been returned to the queue for reconciliation." }, { status: 500 });
  }
  await supabase.from("audit_events").insert({ actor_id: auth.user.id, action: "ACCESS_REQUEST_APPROVED", entity_type: "access_request", entity_id: id, metadata: { provisioned_user_id: userId, assigned_role: assignedRole } });
  return NextResponse.json({ status: "APPROVED", userId, inviteSent: !existing?.id });
}
