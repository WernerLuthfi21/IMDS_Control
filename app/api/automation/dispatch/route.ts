import { NextRequest, NextResponse } from "next/server";
import { internalContext } from "@/lib/automation/auth";
import { dispatch } from "@/lib/automation/outbox";
export const maxDuration = 60;
export async function POST(request: NextRequest) {
  const ctx = await internalContext();
  if ("error" in ctx) return ctx.error;
  const body = await request.json().catch(() => null) as { retryFailed?: boolean } | null;
  // "Retry failed" gives jobs that used up their automatic attempts a fresh start.
  if (body?.retryFailed) await ctx.supabase.from("sync_outbox").update({ attempts: 0, status: "PENDING" }).eq("status", "FAILED");
  return NextResponse.json(await dispatch(ctx.supabase, { limit: 25 }));
}
