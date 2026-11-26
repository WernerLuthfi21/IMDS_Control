import { NextRequest, NextResponse } from "next/server";
import { internalContext } from "@/lib/automation/auth";
import { sameOrigin } from "@/lib/security/request";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request.headers)) return NextResponse.json({ error: "Request rejected." }, { status: 403 });
  const ctx = await internalContext();
  if ("error" in ctx) return ctx.error;
  if (!["admin", "preparer"].includes(ctx.profile.role)) return NextResponse.json({ error: "Admin or preparer role required." }, { status: 403 });
  const { id } = await context.params;
  const { data: campaign } = await ctx.supabase
    .from("whatsapp_campaigns")
    .select("id,status,mode")
    .eq("id", id)
    .maybeSingle();
  if (!campaign) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  if (campaign.mode !== "semi_automatic" || campaign.status !== "AWAITING_APPROVAL") {
    return NextResponse.json({ error: "This campaign is not waiting for semi-automatic approval." }, { status: 409 });
  }

  const { error: messageError } = await ctx.supabase
    .from("whatsapp_messages")
    .update({ status: "PENDING" })
    .eq("campaign_id", id)
    .eq("status", "AWAITING_APPROVAL");
  if (messageError) return NextResponse.json({ error: messageError.message }, { status: 500 });

  const { error } = await ctx.supabase
    .from("whatsapp_campaigns")
    .update({ status: "QUEUED", approved_by: ctx.user.id, approved_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "AWAITING_APPROVAL");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await ctx.supabase.from("audit_events").insert({
    actor_id: ctx.user.id, action: "WHATSAPP_CAMPAIGN_APPROVED",
    entity_type: "whatsapp_campaign", entity_id: id, metadata: {},
  });
  return NextResponse.json({ status: "QUEUED" });
}
