import { NextRequest, NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { allowedStaffDomain, cleanText, normalizeEmail, validEmail, TMMIN_ROLES } from "@/lib/access/validate";
import { hashKey, sameOrigin, siteOrigin } from "@/lib/security/request";
import { overLimit } from "@/lib/security/throttle";
import { notifyApprovers } from "@/lib/access/notify";

/** Signed-in TMMIN staff register a colleague. Nothing is created until an ADMIN approves. */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request.headers)) return NextResponse.json({ error: "Request rejected." }, { status: 403 });
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { data: me } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (!me || !["admin", "preparer", "reviewer"].includes(me.role)) return NextResponse.json({ error: "TMMIN staff role required." }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const name = cleanText(body.name, 80), email = normalizeEmail(body.email), role = String(body.role || "viewer");
  if (name.length < 2) return NextResponse.json({ error: "Enter the colleague's full name." }, { status: 422 });
  if (!validEmail(email)) return NextResponse.json({ error: "Enter a valid email." }, { status: 422 });
  if (!(TMMIN_ROLES as readonly string[]).includes(role)) return NextResponse.json({ error: "Unknown role." }, { status: 422 });
  if (!allowedStaffDomain(email, process.env.STAFF_EMAIL_DOMAINS)) return NextResponse.json({ error: "This email domain is not allowed for TMMIN staff." }, { status: 422 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Access requests are temporarily unavailable." }, { status: 503 });
  if (await overLimit(admin, "staff-req", hashKey("u", auth.user.id), 20, 3600)) return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 });
  const { data: row, error } = await admin.from("access_requests").insert({ kind: "tmmin", via: "STAFF", full_name: name, email, requested_role: role, requested_by: auth.user.id }).select("id,kind,full_name,email,company,supplier_code,via").single();
  if (error?.code === "23505") return NextResponse.json({ error: "A request for this email is already waiting for approval." }, { status: 409 });
  if (error || !row) return NextResponse.json({ error: "Could not submit the request." }, { status: 500 });
  await admin.from("audit_events").insert({ actor_id: auth.user.id, action: "STAFF_ACCESS_REQUESTED", entity_type: "access_request", entity_id: row.id, metadata: { requestedRole: role } });
  const origin = siteOrigin(request.headers);
  after(async () => { try { await notifyApprovers(admin, row, origin); } catch { /* visible in queue */ } });
  return NextResponse.json({ ok: true, id: row.id });
}
