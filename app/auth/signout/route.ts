import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Sign out from pages that are not React (the IMDS Tracker). POST only, so a link elsewhere cannot log you out. */
export async function POST(request: Request) {
  const supabase = await createClient();
  try { await supabase?.auth.signOut(); } catch { /* the cookie is cleared or already gone */ }
  return NextResponse.redirect(new URL("/login", request.url), 303);
}
