import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { canAccessImdsTracker } from "@/lib/security/imds-tracker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await getAuthContext();
  if (!auth.configured) return new NextResponse("IMDS Tracker is unavailable until Supabase authentication is configured.", {
    status: 503, headers: { "Cache-Control": "no-store" }
  });
  if (!auth.userId) return NextResponse.redirect(new URL("/login?next=%2Fimds-tracker", request.url));
  if (auth.roleError) return new NextResponse("Unable to verify workspace permissions. Please retry or contact an administrator.", {
    status: 503, headers: { "Cache-Control": "no-store" }
  });
  if (!canAccessImdsTracker(auth.role)) return new NextResponse("Internal workspace access required.", {
    status: 403, headers: { "Cache-Control": "no-store" }
  });

  try {
    const sourceHtml = await readFile(join(process.cwd(), "private", "imds-tracker.html"), "utf8");
    const shortcut = `<a href="/imds-tracker/master" aria-label="Open shared IMDS Master Data" style="position:fixed;right:18px;bottom:18px;z-index:9999;display:inline-flex;align-items:center;gap:8px;padding:11px 16px;border-radius:999px;background:#6d28d9;color:#fff;text-decoration:none;font:600 13px/1.2 system-ui,sans-serif;box-shadow:0 8px 24px rgba(76,29,149,.24)">▦ Master Data</a>`;
    const html = sourceHtml.replace(/<body(\\s[^>]*)?>/i, (match) => match + shortcut);
    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store, max-age=0, must-revalidate",
        "Pragma": "no-cache",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Content-Disposition": "inline; filename=imds-tracker.html"
      }
    });
  } catch (error) {
    console.error("IMDS Tracker private HTML could not be loaded.", error);
    return new NextResponse("IMDS Tracker could not be loaded. Please contact the application administrator.", {
      status: 500, headers: { "Cache-Control": "no-store" }
    });
  }
}
