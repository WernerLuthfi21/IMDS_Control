import { NextRequest, NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanText, escapeLike, normalizeEmail, validEmail } from "@/lib/access/validate";
import { clientKey, hashKey, sameOrigin, siteOrigin } from "@/lib/security/request";
import { overLimit } from "@/lib/security/throttle";
import { notifyApprovers } from "@/lib/access/notify";

/** Public fallback when the reset e-mail never arrives: asks an administrator to resend it. Same answer for unknown e-mails. */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request.headers)) return NextResponse.json({ error: "Request rejected." }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const email = normalizeEmail(body?.email);
  if (body?.website) return NextResponse.json({ ok: true });
  if (!validEmail(email)) return NextResponse.json({ error: "Enter a valid email." }, { status: 422 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Temporarily unavailable." }, { status: 503 });
  if (await overLimit(admin, "help-ip", clientKey(request.headers), 5, 3600) || await overLimit(admin, "help-email", hashKey("e", email), 2, 86400)) return NextResponse.json({ ok: true });
  const { data: profile } = await admin.from("profiles").select("display_name").ilike("email", escapeLike(email)).maybeSingle();
  if (!profile) return NextResponse.json({ ok: true }); // unknown e-mail: say nothing, create nothing
  const { data: row, error } = await admin.from("access_requests").insert({ kind: "password_help", via: "PUBLIC", full_name: cleanText(profile.display_name || email.split("@")[0], 80) || "User", email }).select("id,kind,full_name,email,company,supplier_code,via").single();
  if (error || !row) return NextResponse.json({ ok: true });
  await admin.from("audit_events").insert({ action: "PASSWORD_HELP_REQUESTED", entity_type: "access_request", entity_id: row.id, metadata: {} });
  const origin = siteOrigin(request.headers);
  after(async () => { try { await notifyApprovers(admin, row, origin); } catch { /* visible in queue */ } });
  return NextResponse.json({ ok: true });
}
