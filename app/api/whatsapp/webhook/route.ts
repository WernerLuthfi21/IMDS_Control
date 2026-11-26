import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshWhatsAppCampaignStatus } from "@/lib/whatsapp/queue";
import { isWhatsAppOptOutText, normalizeWhatsAppE164 } from "@/lib/whatsapp/inbound";

type StatusItem = {
  id?: string;
  status?: string;
  timestamp?: string;
  errors?: Array<{ code?: number; title?: string; message?: string }>;
};
type IncomingItem = { from?: string; type?: string; text?: { body?: string } };
type WebhookBody = {
  entry?: Array<{ changes?: Array<{ value?: { statuses?: StatusItem[]; messages?: IncomingItem[] } }> }>;
};

function verifySignature(raw: string, signature: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !signature?.startsWith("sha256=")) return false;
  const supplied = signature.slice(7);
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  if (!/^[a-f0-9]{64}$/i.test(supplied)) return false;
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(supplied, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token && process.env.WHATSAPP_VERIFY_TOKEN &&
      token === process.env.WHATSAPP_VERIFY_TOKEN && challenge) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return NextResponse.json({ error: "Webhook verification failed." }, { status: 403 });
}

export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (!verifySignature(raw, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }
  let body: WebhookBody;
  try {
    body = JSON.parse(raw) as WebhookBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const updates: Array<{ id: string; status: string; timestamp?: string; error?: string }> = [];
  const optOutPhones = new Set<string>();
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      for (const message of change.value?.messages || []) {
        if (message.from && message.type === "text" && isWhatsAppOptOutText(message.text?.body || "")) {
          const phone = normalizeWhatsAppE164(message.from);
          if (phone) optOutPhones.add(phone);
        }
      }
      for (const item of change.value?.statuses || []) {
        if (!item.id || !item.status) continue;
        const status = item.status.toLowerCase();
        if (!["sent", "delivered", "read", "failed"].includes(status)) continue;
        const error = item.errors?.[0];
        updates.push({
          id: item.id,
          status,
          timestamp: item.timestamp,
          error: error ? [error.code, error.title, error.message].filter(Boolean).join(" · ").slice(0, 500) : undefined,
        });
      }
    }
  }

  const supabase = createAdminClient();
  if (!supabase) return NextResponse.json({ error: "Webhook database is not configured." }, { status: 503 });
  const changedCampaigns = new Set<string>();
  for (const phone of optOutPhones) {
    const optedOutAt = new Date().toISOString();
    await supabase.from("supplier_contacts").update({
      whatsapp_opt_in: false,
      whatsapp_opt_out_at: optedOutAt,
      whatsapp_consent_source: "Inbound WhatsApp opt-out keyword",
    }).eq("whatsapp_phone_e164", phone);
    const { data: pending } = await supabase.from("whatsapp_messages")
      .select("id,campaign_id")
      .eq("recipient_phone", phone)
      .in("status", ["PENDING", "AWAITING_APPROVAL"]);
    const pendingIds = (pending || []).map((row) => row.id);
    if (pendingIds.length) {
      await supabase.from("whatsapp_messages").update({
        status: "CANCELLED", error_message: "Recipient opted out via inbound WhatsApp keyword.",
      }).in("id", pendingIds);
      for (const row of pending || []) changedCampaigns.add(row.campaign_id);
    }
  }
  const rank: Record<string, number> = { SENT: 1, DELIVERED: 2, FAILED: 3, READ: 4 };

  for (const update of updates) {
    const at = update.timestamp && /^\d+$/.test(update.timestamp)
      ? new Date(Number(update.timestamp) * 1000).toISOString()
      : new Date().toISOString();
    const { data: existing } = await supabase
      .from("whatsapp_messages")
      .select("campaign_id,status,last_status_at")
      .eq("provider_message_id", update.id)
      .maybeSingle();
    if (!existing) continue;

    // Webhook deliveries may be retried or arrive out of order; never move a message backward.
    if (existing.last_status_at && new Date(existing.last_status_at).getTime() > new Date(at).getTime()) continue;
    const nextStatus = update.status.toUpperCase();
    if ((rank[existing.status] || 0) > (rank[nextStatus] || 0)) continue;

    const patch: Record<string, unknown> = {
      status: nextStatus,
      provider_status: update.status,
      last_status_at: at,
    };
    if (update.status === "delivered") patch.delivered_at = at;
    if (update.status === "read") patch.read_at = at;
    if (update.status === "failed") patch.error_message = update.error || "Meta reported message delivery failure.";
    const { error } = await supabase.from("whatsapp_messages").update(patch).eq("provider_message_id", update.id);
    if (!error) changedCampaigns.add(existing.campaign_id);
  }

  for (const campaignId of changedCampaigns) {
    await refreshWhatsAppCampaignStatus(supabase, campaignId);
  }
  return NextResponse.json({ received: true, statusUpdates: updates.length, optOutsProcessed: optOutPhones.size });
}
