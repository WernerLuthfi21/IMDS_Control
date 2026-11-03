import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canAccessImdsTracker } from "@/lib/security/imds-tracker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = await createClient();
  if (!supabase) return new NextResponse("IMDS Tracker is unavailable until Supabase authentication is configured.", {
    status: 503, headers: { "Cache-Control": "no-store" }
  });

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.redirect(new URL("/login?next=%2Fimds-tracker", request.url));

  const { data: profile, error } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (error) return new NextResponse("Unable to verify workspace permissions. Please retry or contact an administrator.", {
    status: 503, headers: { "Cache-Control": "no-store" }
  });
  if (!canAccessImdsTracker(profile?.role)) return new NextResponse("Internal workspace access required.", {
    status: 403, headers: { "Cache-Control": "no-store" }
  });

  try {
    let html = await readFile(join(process.cwd(), "private", "imds-tracker.html"), "utf8");
    // Restore the original Violet Refractive brand palette. Semantic OK/NG colours stay unchanged.
    html = html.replace("Green Industrial Glass · Editorial Workspace", "Violet Refractive · Editorial Industrial Glass")
      .replace('content="#F4F8F5"', 'content="#F7F5FA"')
      .replace("--green:#167A45;--green-deep:#14532D;--green-accent:#22A06B;--green-soft:#E8F5EC;--green-mist:#D5EBDD;", "--green:#7C3AED;--green-deep:#4C1D95;--green-accent:#9333EA;--green-soft:#F1EAFE;--green-mist:#E9DDFB;")
      .replace("--bg:#F4F8F5;--bg-2:#EDF4EF;--surface:#FFFFFF;--surface-2:#F8FBF8;--ink:#1C2A20;--muted:#5D6C61;--faint:#849188;", "--bg:#F7F5FA;--bg-2:#F0EDF5;--surface:#FFFFFF;--surface-2:#FAF8FD;--ink:#211A2B;--muted:#665D71;--faint:#8A8195;")
      .replace("--line:rgba(20,83,45,.12);--line-strong:rgba(20,83,45,.24);", "--line:rgba(76,29,149,.13);--line-strong:rgba(76,29,149,.26);")
      .replace("--brand-text:#166534;--focus:#167A45;", "--brand-text:#5B21B6;--focus:#6D28D9;")
      .replace("--glass:rgba(255,255,255,.68);--glass-strong:rgba(255,255,255,.88);--glass-edge:rgba(255,255,255,.82);--glass-edge-2:rgba(22,122,69,.14);", "--glass:rgba(255,255,255,.62);--glass-strong:rgba(255,255,255,.82);--glass-edge:rgba(255,255,255,.75);--glass-edge-2:rgba(124,58,237,.16);")
      .replace("--sh-1:0 1px 2px rgba(20,55,31,.05),0 4px 14px rgba(20,55,31,.055);--sh-2:0 2px 4px rgba(20,55,31,.07),0 18px 44px rgba(20,83,45,.13);", "--sh-1:0 1px 2px rgba(45,18,90,.06),0 4px 14px rgba(45,18,90,.06);--sh-2:0 2px 4px rgba(45,18,90,.07),0 18px 44px rgba(76,29,149,.16);")
      .replace("--scrim:rgba(10,28,16,.46);", "--scrim:rgba(24,12,48,.45);")
      .replace("--green:#4ADE80;--green-soft:#1F3829;--green-mist:#294B36;", "--green:#8B5CF6;--green-soft:#2A2040;--green-mist:#35295A;")
      .replace("--bg:#111A14;--bg-2:#17221A;--surface:#1C2B21;--surface-2:#223329;--ink:#EAF3EC;--muted:#A8BBAE;--faint:#829788;", "--bg:#14101C;--bg-2:#1A1526;--surface:#1E1830;--surface-2:#241D38;--ink:#EEE9F7;--muted:#B0A6C2;--faint:#8D83A0;")
      .replace("--line:rgba(151,205,169,.14);--line-strong:rgba(151,205,169,.27);", "--line:rgba(196,181,253,.14);--line-strong:rgba(196,181,253,.28);")
      .replace("--brand-text:#86D7A1;--focus:#86D7A1;", "--brand-text:#C4B5FD;--focus:#C4B5FD;")
      .replace("--glass:rgba(28,48,36,.62);--glass-strong:rgba(28,48,36,.88);--glass-edge:rgba(151,205,169,.20);--glass-edge-2:rgba(74,222,128,.20);", "--glass:rgba(34,26,54,.58);--glass-strong:rgba(34,26,54,.86);--glass-edge:rgba(196,181,253,.22);--glass-edge-2:rgba(167,139,250,.22);")
      .replace("--scrim:rgba(5,14,8,.66);", "--scrim:rgba(5,2,12,.62);")
      .replace("rgba(22,122,69,.18)", "rgba(124,58,237,.18)");
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
