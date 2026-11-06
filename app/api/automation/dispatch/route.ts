import { NextResponse } from "next/server";
import { internalContext } from "@/lib/automation/auth";
import { dispatch } from "@/lib/automation/outbox";
export const maxDuration = 60;
export async function POST() {
  const ctx = await internalContext();
  if ("error" in ctx) return ctx.error;
  return NextResponse.json(await dispatch(ctx.supabase, { limit: 25 }));
}
