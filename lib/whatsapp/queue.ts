import type { SupabaseClient } from "@supabase/supabase-js";
import { getWhatsAppSender } from "./config";
import { sendWhatsAppTemplate } from "./cloud-api";

type QueueMessage = {
  id: string;
  campaign_id: string;
  recipient_phone: string;
  sender_key: string;
  template_name: string;
  template_language: string;
  template_parameters: unknown;
  attempts: number;
};

export async function dispatchWhatsAppQueue(
  supabase: SupabaseClient,
  options: { limit?: number; campaignId?: string; fetchImpl?: typeof fetch } = {},
) {
  const summary = { accepted: 0, failed: 0, skipped: 0, processed: 0 };
  const limit = Math.max(1, Math.min(options.limit ?? 20, 50));

  let query = supabase
    .from("whatsapp_messages")
    .select("id,campaign_id,recipient_phone,sender_key,template_name,template_language,template_parameters,attempts")
    .eq("status", "PENDING")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (options.campaignId) query = query.eq("campaign_id", options.campaignId);

  const { data: messages, error } = await query;
  if (error) throw new Error("Could not read WhatsApp queue: " + error.message);

  for (const message of (messages || []) as QueueMessage[]) {
    const { data: claimed, error: claimError } = await supabase
      .from("whatsapp_messages")
      .update({ status: "SENDING", attempts: message.attempts + 1, error_message: null })
      .eq("id", message.id)
      .eq("status", "PENDING")
      .select("id")
      .maybeSingle();

    if (claimError) {
      summary.failed++;
      continue;
    }
    if (!claimed) {
      summary.skipped++;
      continue;
    }

    summary.processed++;
    try {
      const sender = getWhatsAppSender(message.sender_key);
      if (!sender) throw new Error("Configured WhatsApp sender is missing or disabled.");
      const parameters = Array.isArray(message.template_parameters)
        ? message.template_parameters.filter((value): value is string => typeof value === "string")
        : [];
      const result = await sendWhatsAppTemplate(sender, {
        to: message.recipient_phone,
        templateName: message.template_name,
        language: message.template_language,
        parameters,
      }, options.fetchImpl);

      const { error: saveError } = await supabase
        .from("whatsapp_messages")
        .update({
          status: "SENT",
          provider_status: "accepted",
          provider_message_id: result.messageId,
          sent_at: new Date().toISOString(),
          error_message: null,
        })
        .eq("id", message.id);
      if (saveError) throw new Error("Meta accepted the message but the status could not be saved: " + saveError.message);
      summary.accepted++;
    } catch (error) {
      const messageText = error instanceof Error ? error.message.slice(0, 500) : "WhatsApp send failed.";
      await supabase.from("whatsapp_messages").update({
        status: "FAILED",
        error_message: messageText,
        provider_status: "failed",
      }).eq("id", message.id);
      summary.failed++;
    }
  }

  if (options.campaignId) {
    const { data: statuses } = await supabase
      .from("whatsapp_messages")
      .select("status")
      .eq("campaign_id", options.campaignId);
    const rows = statuses || [];
    const remaining = rows.some((row) => ["PENDING", "SENDING", "AWAITING_APPROVAL"].includes(row.status));
    const failed = rows.some((row) => row.status === "FAILED");
    const accepted = rows.some((row) => ["SENT", "DELIVERED", "READ"].includes(row.status));
    const status = remaining ? (accepted || failed ? "RUNNING" : "QUEUED") : failed ? (accepted ? "PARTIAL" : "FAILED") : "COMPLETED";
    await supabase.from("whatsapp_campaigns").update({ status }).eq("id", options.campaignId);
  } else {
    const touchedCampaignIds = [...new Set((messages || []).map((row) => row.campaign_id))];
    for (const campaignId of touchedCampaignIds) {
      const { data: statuses } = await supabase
        .from("whatsapp_messages")
        .select("status")
        .eq("campaign_id", campaignId);
      const rows = statuses || [];
      const remaining = rows.some((row) => ["PENDING", "SENDING", "AWAITING_APPROVAL"].includes(row.status));
      const failed = rows.some((row) => row.status === "FAILED");
      const accepted = rows.some((row) => ["SENT", "DELIVERED", "READ"].includes(row.status));
      const status = remaining ? (accepted || failed ? "RUNNING" : "QUEUED") : failed ? (accepted ? "PARTIAL" : "FAILED") : "COMPLETED";
      await supabase.from("whatsapp_campaigns").update({ status }).eq("id", campaignId);
    }
  }

  return summary;
}
