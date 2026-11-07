import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { canAccessImdsTracker } from "@/lib/security/imds-tracker";
import { dispatchPartMasterOutbox } from "@/lib/imds-master/outbox";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const auth = await getAuthContext();
  if (!auth.configured) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  if (!auth.userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!canAccessImdsTracker(auth.role)) return NextResponse.json({ error: "Internal workspace access required." }, { status: 403 });

  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });

  const [pending, failed, sending, sent] = await Promise.all([
    supabase.from("imds_tracker_outbox").select("id", { count: "exact", head: true }).eq("status", "PENDING"),
    supabase.from("imds_tracker_outbox").select("id", { count: "exact", head: true }).eq("status", "FAILED"),
    supabase.from("imds_tracker_outbox").select("id", { count: "exact", head: true }).eq("status", "SENDING"),
    supabase.from("imds_tracker_outbox").select("id", { count: "exact", head: true }).eq("status", "SENT")
  ]);
  const firstError = pending.error || failed.error || sending.error || sent.error;
  if (firstError) return NextResponse.json({ error: firstError.message }, { status: 500 });

  return NextResponse.json({
    configured: Boolean(process.env.POWER_AUTOMATE_TRACKER_URL?.trim()),
    queue: { pending: pending.count || 0, failed: failed.count || 0, sending: sending.count || 0, sent: sent.count || 0 },
    checkedAt: new Date().toISOString()
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(_request: NextRequest) {
  const auth = await getAuthContext();
  if (!auth.configured) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  if (!auth.userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!["admin", "preparer", "reviewer"].includes(auth.role || "")) {
    return NextResponse.json({ error: "Admin, preparer or reviewer role is required to run master sync." }, { status: 403 });
  }

  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  try {
    const result = await dispatchPartMasterOutbox(supabase, 50);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Master sync failed." }, { status: 500 });
  }
}
