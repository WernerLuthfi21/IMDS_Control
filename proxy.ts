import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy, makeNonce } from "@/lib/security/headers";

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const pathname = request.nextUrl.pathname;
  const isApi = pathname.startsWith("/api/");
  const isSetupPage = pathname === "/setup-required";
  // Pages a signed-out person must reach: sign-in, forgot password, the e-mailed link landing, and the public access API.
  const isPublic = ["/login", "/forgot-password", "/auth/confirm", "/reset-password"].includes(pathname);

  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set("x-pathname", pathname);
  // Per-request CSP nonce for app pages (docs/SECURITY.md). Next.js reads it from the request CSP header and tags
  // its own scripts; the layout tags the theme script via x-nonce. The Tracker keeps its own policy (next.config.ts).
  const isTracker = pathname === "/imds-tracker" || pathname.startsWith("/imds-tracker/");
  const nonce = isApi || isTracker ? null : makeNonce();
  const csp = nonce ? contentSecurityPolicy({ dev: process.env.NODE_ENV !== "production", supabaseUrl: url, nonce }) : null;
  if (nonce && csp) { forwardedHeaders.set("x-nonce", nonce); forwardedHeaders.set("content-security-policy", csp); }
  const withCsp = <T extends NextResponse>(res: T): T => { if (csp) res.headers.set("Content-Security-Policy", csp); return res; };

  if (!url || !key) {
    if (process.env.NODE_ENV === "production" && !isSetupPage && !isApi) {
      return withCsp(NextResponse.redirect(new URL("/setup-required", request.url)));
    }
    return withCsp(NextResponse.next({ request: { headers: forwardedHeaders } }));
  }

  let response = NextResponse.next({ request: { headers: forwardedHeaders } });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request: { headers: forwardedHeaders } });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      }
    }
  });
  // Local JWT verification + session refresh; role-based routing happens once per request in the layout.
  const { data: claimsData } = await supabase.auth.getClaims();
  const user = claimsData?.claims?.sub ? claimsData.claims : null;

  // API handlers return JSON 401 responses; do not redirect fetch clients to the login page.
  if (!user && !isApi && !isPublic && !isSetupPage) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
    return withCsp(NextResponse.redirect(loginUrl));
  }
  if (user && pathname === "/login") {
    return withCsp(NextResponse.redirect(new URL("/workspace", request.url)));
  }
  return withCsp(response);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"]
};
