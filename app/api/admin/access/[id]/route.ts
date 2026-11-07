import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanText, grantableRoles, normalizeSupplierCode, SUPPLIER_CODE } from "@/lib/access/validate";
import { sameOrigin, siteOrigin } from "@/lib/security/request";

export const runtime = "nodejs";

/** Admin-only decision on an access request. Account creation uses the service role on the server; nothing is auto-approved. */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid request id." }, { status: 400 });
  if (!sameOrigin(request.headers)) return NextResponse.json({ error: "Request rejected." }, { status: 403 });
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { data: me } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (me?.role !== "admin") return NextResponse.json({ error: "Only an admin can decide access requests." }, { status: 403 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not configured on the server." }, { status: 503 });
  const body = await request.json().catch(() => null) as { action?: string; role?: string; supplierCode?: string; note?: string } | null;
  if (!body || !["approve", "reject"].includes(String(body.action))) return NextResponse.json({ error: "action must be approve or reject." }, { status: 400 });
  const { data: req } = await admin.from("access_requests").select("*").eq("id", id).maybeSingle();
  if (!req) return NextResponse.json({ error: "Request not found." }, { status: 404 });
  if (req.status !== "PENDING") return NextResponse.json({ error: "This request was already decided." }, { status: 409 });
  const note = cleanText(body.note, 300) || null;
  const decided = { decided_by: auth.user.id, decided_at: new Date().toISOString(), decision_note: note };

  if (body.action === "reject") {
    await admin.from("access_requests").update({ ...decided, status: "REJECTED" }).eq("id", id);
    await admin.from("audit_events").insert({ actor_id: auth.user.id, action: "ACCESS_REQUEST_REJECTED", entity_type: "access_request", entity_id: id, metadata: { kind: req.kind } });
    return NextResponse.json({ ok: true, status: "REJECTED" });
  }

  const origin = siteOrigin(request.headers);
  const redirectTo = `${origin}/auth/confirm?next=/reset-password`;
  if (req.kind === "password_help") {
    const { error } = await supabase.auth.resetPasswordForEmail(req.email, { redirectTo });
    if (error) return NextResponse.json({ error: "Could not send the reset email: " + error.message }, { status: 502 });
    await admin.from("access_requests").update({ ...decided, status: "APPROVED" }).eq("id", id);
    await admin.from("audit_events").insert({ actor_id: auth.user.id, action: "PASSWORD_RESET_SENT_BY_ADMIN", entity_type: "access_request", entity_id: id, metadata: {} });
    return NextResponse.json({ ok: true, status: "APPROVED", note: "Reset email handed to the auth mail service." });
  }

  if (req.requested_by && req.requested_by === auth.user.id) {
    // Four-eyes: another admin must approve your own request, unless you are the only admin.
    const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin");
    if ((count ?? 0) > 1) return NextResponse.json({ error: "A second admin must approve a request you submitted." }, { status: 403 });
  }
  const role = String(body.role || (req.kind === "supplier" ? "supplier" : req.requested_role || "viewer"));
  if (!grantableRoles(req.kind).includes(role)) return NextResponse.json({ error: "That role cannot be granted for this request type." }, { status: 422 });
  let supplierCode: string | null = null;
  if (role === "supplier") {
    supplierCode = normalizeSupplierCode(body.supplierCode || req.supplier_code);
    if (!SUPPLIER_CODE.test(supplierCode)) return NextResponse.json({ error: "A valid supplier code is required for supplier accounts." }, { status: 422 });
  }
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(req.email, { data: { display_name: req.full_name }, redirectTo });
  if (inviteError || !invited.user) {
    const exists = /already|registered|exists/i.test(inviteError?.message || "");
    return NextResponse.json({ error: exists ? "An account with this email already exists. Edit it in Team access instead." : "Could not create the account: " + (inviteError?.message || "unknown error") }, { status: exists ? 409 : 502 });
  }
  const { error: profileError } = await admin.from("profiles").update({ role, supplier_code: supplierCode, display_name: req.full_name }).eq("id", invited.user.id);
  if (profileError) return NextResponse.json({ error: "Account created but the role could not be set: " + profileError.message }, { status: 500 });
  await admin.from("access_requests").update({ ...decided, status: "APPROVED", granted_role: role }).eq("id", id);
  await admin.from("audit_events").insert({ actor_id: auth.user.id, action: "ACCESS_REQUEST_APPROVED", entity_type: "access_request", entity_id: id, metadata: { kind: req.kind, role, supplierCode } });
  return NextResponse.json({ ok: true, status: "APPROVED", note: "Invitation handed to the auth mail service; the user sets a password from the link." });
}
