import { NextResponse } from "next/server";
import { isSupabaseConfigured, appName } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const configured = isSupabaseConfigured;
  let dbStatus = "unconfigured";

  if (configured) {
    try {
      const supabase = await createClient();
      if (supabase) {
        const { error } = await supabase.from("gcat_error_items").select("id").limit(1);
        dbStatus = error ? `error: ${error.message}` : "connected";
      }
    } catch (e) {
      dbStatus = e instanceof Error ? e.message : "connection_failed";
    }
  }

  return NextResponse.json({
    status: "ok",
    app: appName,
    version: "0.2.2",
    supabaseConfigured: configured,
    databaseStatus: dbStatus,
    timestamp: new Date().toISOString()
  }, { headers: { "Cache-Control": "no-store" } });
}
