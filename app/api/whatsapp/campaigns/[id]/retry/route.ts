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
    .select("id,status")
    .eq("id", id)
    .maybeSingle();
  if (!campaign) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });

  const { data: failed, error: readError } = await ctx.supabase
    .from("whatsapp_messages")
    .select("id,attempts")
    .eq("campaign_id", id)
    .eq("status", "FAILED")
    .limit(1000);
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
  const retryIds = (failed || []).filter((row) => row.attempts < 3).map((row) => row.id);
  if (!retryIds.length) return NextResponse.json({ error: "No failed messages remain eligible for retry (maximum 3 attempts)." }, { status: 409 });

  const { error } = await ctx.supabase
    .from("whatsapp_messages")
    .update({ status: "PENDING", error_message: null })
    .in("id", retryIds)
    .eq("status", "FAILED");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await ctx.supabase.from("whatsapp_campaigns").update({ status: "QUEUED" }).eq("id", id);
  await ctx.supabase.from("audit_events").insert({
    actor_id: ctx.user.id, action: "WHATSAPP_CAMPAIGN_RETRY_QUEUED",
    entity_type: "whatsapp_campaign", entity_id: id, metadata: { count: retryIds.length },
  });
  return NextResponse.json({ queued: retryIds.length });
}
