import { NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/security/next-path";

/** Landing for e-mailed links (reset password, invite). Supports token_hash links and PKCE `code` links. */
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const next = safeNextPath(p.get("next"), "/reset-password");
  const fail = NextResponse.redirect(new URL("/login?error=link", request.url));
  const supabase = await createClient();
  if (!supabase) return fail;
  const tokenHash = p.get("token_hash"), type = p.get("type") as EmailOtpType | null, code = p.get("code");
  if (tokenHash && type) { const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash }); if (error) return fail; }
  else if (code) { const { error } = await supabase.auth.exchangeCodeForSession(code); if (error) return fail; }
  else return fail;
  return NextResponse.redirect(new URL(next, request.url));
}
