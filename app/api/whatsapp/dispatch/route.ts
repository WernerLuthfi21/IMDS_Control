import { NextRequest, NextResponse } from "next/server";
import { internalContext } from "@/lib/automation/auth";
import { sameOrigin } from "@/lib/security/request";
import { dispatchWhatsAppQueue } from "@/lib/whatsapp/queue";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (!sameOrigin(request.headers)) return NextResponse.json({ error: "Request rejected." }, { status: 403 });
  const ctx = await internalContext();
  if ("error" in ctx) return ctx.error;
  if (!["admin", "preparer"].includes(ctx.profile.role)) return NextResponse.json({ error: "Admin or preparer role required." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { campaignId?: string; limit?: number };
  const result = await dispatchWhatsAppQueue(ctx.supabase, {
    campaignId: body.campaignId,
    limit: Number.isFinite(body.limit) ? Number(body.limit) : 6,
  });
  await ctx.supabase.from("audit_events").insert({
    actor_id: ctx.user.id, action: "WHATSAPP_QUEUE_DISPATCHED",
    entity_type: "whatsapp_campaign", entity_id: body.campaignId || null,
    metadata: result,
  });
  return NextResponse.json(result);
}
