import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeEmail, validEmail } from "@/lib/access/validate";
import { clientKey, hashKey, sameOrigin, siteOrigin } from "@/lib/security/request";
import { overLimit } from "@/lib/security/throttle";

/** Public. Same answer whether or not the e-mail has an account (no account enumeration). Applies to suppliers and TMMIN staff alike. */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request.headers)) return NextResponse.json({ error: "Request rejected." }, { status: 403 });
  const body = await request.json().catch(() => null) as { email?: unknown } | null;
  const email = normalizeEmail(body?.email);
  if (!validEmail(email)) return NextResponse.json({ error: "Enter a valid email." }, { status: 422 });
  const admin = createAdminClient();
  if (admin && (await overLimit(admin, "forgot-ip", clientKey(request.headers), 10, 3600) || await overLimit(admin, "forgot-email", hashKey("e", email), 3, 3600)))
    return NextResponse.json({ ok: true }); // silently stop sending; do not reveal the limit per e-mail
  const supabase = await createClient();
  if (supabase) await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${siteOrigin(request.headers)}/auth/confirm?next=/reset-password` });
  return NextResponse.json({ ok: true });
}
