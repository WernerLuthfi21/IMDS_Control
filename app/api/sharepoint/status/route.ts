import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { getMasterFileInfo, sharepointConfig } from "@/lib/sharepoint/graph";

export const runtime = "nodejs";

/** Is the SharePoint master workbook configured and reachable? Never returns secrets. */
export async function GET() {
  const auth = await getAuthContext();
  if (!auth.configured) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  if (!auth.userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!auth.role || !["admin", "preparer", "reviewer"].includes(auth.role)) return NextResponse.json({ error: "Internal role required." }, { status: 403 });
  const cfg = sharepointConfig();
  if (!cfg.configured) return NextResponse.json({ configured: false, missing: cfg.missing, reachable: false });
  try { return NextResponse.json({ configured: true, reachable: true, file: await getMasterFileInfo() }, { headers: { "Cache-Control": "no-store" } }); }
  catch (e) { return NextResponse.json({ configured: true, reachable: false, error: e instanceof Error ? e.message : "SharePoint could not be reached." }); }
}
