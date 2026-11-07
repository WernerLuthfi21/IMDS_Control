import { NextRequest, NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { escapeLike, validateSupplierRequest } from "@/lib/access/validate";
import { clientKey, hashKey, sameOrigin, siteOrigin } from "@/lib/security/request";
import { overLimit } from "@/lib/security/throttle";
import { notifyApprovers } from "@/lib/access/notify";

const OK = () => NextResponse.json({ ok: true });

/** Public. Supplier self-request ONLY. Always answers the same way for valid input so it cannot be used to probe accounts. */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request.headers)) return NextResponse.json({ error: "Request rejected." }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  if (body.website) return OK(); // honeypot field: real users never fill it
  const v = validateSupplierRequest(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 422 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Access requests are temporarily unavailable." }, { status: 503 });
  const { name, company, email, supplierCode, password } = v.value;
  if (await overLimit(admin, "req-ip", clientKey(request.headers), 5, 3600) || await overLimit(admin, "req-email", hashKey("e", email), 3, 86400))
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 });
  const { data: match } = await admin.from("supplier_contacts").select("id").eq("supplier_code", supplierCode).ilike("email", escapeLike(email)).eq("active", true).limit(1);
  // Create the login now, but BANNED: it cannot sign in until an admin approves. Supabase stores only the password hash.
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: false, ban_duration: "876000h", user_metadata: { display_name: name } });
  if (createError || !created.user) return OK(); // existing account or other refusal: same answer, nothing revealed
  if (!created.user.banned_until) { await admin.auth.admin.deleteUser(created.user.id); return NextResponse.json({ error: "Could not submit the request." }, { status: 500 }); }
  await admin.from("profiles").update({ role: "supplier", supplier_code: null, display_name: name }).eq("id", created.user.id);
  const { data: row, error } = await admin.from("access_requests").insert({ kind: "supplier", via: "PUBLIC", full_name: name, company, supplier_code: supplierCode, email, contact_matched: !!match?.length, user_id: created.user.id }).select("id,kind,full_name,email,company,supplier_code,via").single();
  if (error || !row) { await admin.auth.admin.deleteUser(created.user.id); return error?.code === "23505" ? OK() : NextResponse.json({ error: "Could not submit the request." }, { status: 500 }); }
  await admin.from("audit_events").insert({ action: "ACCESS_REQUESTED", entity_type: "access_request", entity_id: row.id, metadata: { kind: "supplier", supplierCode, contactMatched: !!match?.length } });
  const origin = siteOrigin(request.headers);
  after(async () => { try { await notifyApprovers(admin, row, origin); } catch { /* request stays visible in the admin queue */ } });
  return OK();
}
