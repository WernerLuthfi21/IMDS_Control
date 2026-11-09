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
    const syncScript = await readFile(join(process.cwd(), "private", "shared-master-sync.js"), "utf8");
    // The Tracker's own code lives inside one IIFE; the shared-master script needs its helpers (todayStart, classify,
    // commitDataset, SRC, …), so it must be injected INSIDE that scope, right after its last statement.
    const anchor = "  tryAutoReconnect();\n})();";
    if (!sourceHtml.includes(anchor)) throw new Error("Tracker injection anchor not found.");
    const html = sourceHtml.replace(anchor, () => "  tryAutoReconnect();\n" + syncScript + "\n})();");
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
