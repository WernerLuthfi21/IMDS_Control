import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchWhatsAppQueue } from "@/lib/whatsapp/queue";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const expected = process.env.WHATSAPP_CRON_SECRET;
  const authorization = request.headers.get("authorization") || "";
  if (!expected || authorization !== "Bearer " + expected) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const supabase = createAdminClient();
  if (!supabase) return NextResponse.json({ error: "Server-side Supabase service key is not configured." }, { status: 503 });
  const body = await request.json().catch(() => ({})) as { limit?: number };
  const result = await dispatchWhatsAppQueue(supabase, {
    limit: Number.isFinite(body.limit) ? Number(body.limit) : 25,
  });
  return NextResponse.json(result);
}
