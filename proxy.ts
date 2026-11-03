import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const pathname = request.nextUrl.pathname;
  const isApi = pathname.startsWith("/api/");
  const isSetupPage = pathname === "/setup-required";

  if (!url || !key) {
    if (process.env.NODE_ENV === "production" && !isSetupPage && !isApi) {
      return NextResponse.redirect(new URL("/setup-required", request.url));
    }
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      }
    }
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (user && !isApi && pathname !== "/login" && !isSetupPage) {
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (profile?.role === "supplier" && pathname !== "/supplier-precheck") {
      return NextResponse.redirect(new URL("/supplier-precheck", request.url));
    }
  }

  // API handlers return JSON 401 responses; do not redirect fetch clients to the login page.
  if (!user && !isApi && pathname !== "/login" && !isSetupPage) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }
  if (user && pathname === "/login") {
    return NextResponse.redirect(new URL("/workspace", request.url));
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"]
};
