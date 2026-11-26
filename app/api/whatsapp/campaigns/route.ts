export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { internalContext } from "@/lib/automation/auth";
import { sameOrigin } from "@/lib/security/request";
import { getWhatsAppSender } from "@/lib/whatsapp/config";
import { fetchApprovedTemplates } from "@/lib/whatsapp/cloud-api";
import { renderWhatsAppTemplateParameters } from "@/lib/whatsapp/parameters";

type Contact = {
  id: string; supplier_code: string; supplier_name: string | null; contact_name: string | null;
  whatsapp_phone_e164: string | null; whatsapp_opt_in: boolean;
};

export async function GET() {
  const ctx = await internalContext();
  if ("error" in ctx) return ctx.error;
  const { data: campaigns, error } = await ctx.supabase
    .from("whatsapp_campaigns")
    .select("id,name,sender_key,sender_label,sender_phone,template_name,template_language,mode,status,total_count,created_at,approved_at")
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const ids = (campaigns || []).map((campaign) => campaign.id);
  const counts: Record<string, Record<string, number>> = {};
  if (ids.length) {
    const { data: messages } = await ctx.supabase
      .from("whatsapp_messages")
      .select("campaign_id,status")
      .in("campaign_id", ids)
      .limit(50000);
    for (const row of messages || []) {
      counts[row.campaign_id] ||= {};
      counts[row.campaign_id][row.status] = (counts[row.campaign_id][row.status] || 0) + 1;
    }
  }
  return NextResponse.json({
    campaigns: (campaigns || []).map((campaign) => ({ ...campaign, counts: counts[campaign.id] || {} })),
  });
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request.headers)) return NextResponse.json({ error: "Request rejected." }, { status: 403 });
  const ctx = await internalContext();
  if ("error" in ctx) return ctx.error;
  if (!["admin", "preparer"].includes(ctx.profile.role)) {
    return NextResponse.json({ error: "Admin or preparer role required to create a campaign." }, { status: 403 });
  }

  const body = await request.json().catch(() => null) as {
    name?: string; senderKey?: string; templateName?: string; templateLanguage?: string;
    bodyParameters?: string[]; mode?: "automatic" | "semi_automatic"; supplierCode?: string;
  } | null;
  const name = String(body?.name || "").trim();
  const senderKey = String(body?.senderKey || "").trim();
  const templateName = String(body?.templateName || "").trim();
  const templateLanguage = String(body?.templateLanguage || "").trim();
  const mode = body?.mode;
  const bodyParameters = Array.isArray(body?.bodyParameters)
    ? body!.bodyParameters.map((value) => String(value).trim()).filter(Boolean)
    : [];
  const supplierCode = String(body?.supplierCode || "").trim();

  if (!name || name.length > 120 || !senderKey || !/^[a-z0-9_]+$/i.test(templateName) ||
      !/^([a-z]{2,3})(_[A-Z]{2})?$/.test(templateLanguage) || !["automatic", "semi_automatic"].includes(String(mode))) {
    return NextResponse.json({ error: "Campaign name, sender, approved template, language and sending mode are required." }, { status: 422 });
  }
  if (bodyParameters.length > 10 || bodyParameters.some((parameter) => parameter.length > 512)) {
    return NextResponse.json({ error: "A template can contain at most 10 text parameters, each up to 512 characters." }, { status: 422 });
  }

  const sender = getWhatsAppSender(senderKey);
  if (!sender) return NextResponse.json({ error: "Selected WhatsApp sender is not configured." }, { status: 422 });

  let approved = false;
  try {
    const templates = await fetchApprovedTemplates(sender);
    approved = templates.some((template) => template.name === templateName && template.language === templateLanguage);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not verify Meta template." }, { status: 502 });
  }
  if (!approved) {
    return NextResponse.json({ error: "Selected template is not approved for this sender and language in Meta Business Manager." }, { status: 422 });
  }

  let contactsQuery = ctx.supabase
    .from("supplier_contacts")
    .select("id,supplier_code,supplier_name,contact_name,whatsapp_phone_e164,whatsapp_opt_in")
    .eq("active", true)
    .eq("whatsapp_opt_in", true)
    .not("whatsapp_phone_e164", "is", null)
    .order("supplier_code", { ascending: true })
    .limit(1000);
  if (supplierCode) contactsQuery = contactsQuery.eq("supplier_code", supplierCode);
  const { data: rawContacts, error: contactsError } = await contactsQuery;
  if (contactsError) return NextResponse.json({ error: contactsError.message }, { status: 500 });

  const contacts = ((rawContacts || []) as Contact[]).filter((contact) =>
    /^\+[1-9]\d{7,14}$/.test(String(contact.whatsapp_phone_e164 || "")) && contact.whatsapp_opt_in,
  );
  if (!contacts.length) {
    return NextResponse.json({ error: "No active supplier contacts have both a valid WhatsApp number and recorded opt-in." }, { status: 422 });
  }

  const status = mode === "semi_automatic" ? "AWAITING_APPROVAL" : "QUEUED";
  const { data: campaign, error: campaignError } = await ctx.supabase
    .from("whatsapp_campaigns")
    .insert({
      name, sender_key: sender.key, sender_label: sender.label, sender_phone: sender.displayPhoneNumber,
      template_name: templateName, template_language: templateLanguage,
      body_parameter_templates: bodyParameters, mode, status,
      total_count: contacts.length, created_by: ctx.user.id,
    })
    .select("id,name,status,total_count")
    .single();
  if (campaignError || !campaign) {
    return NextResponse.json({ error: campaignError?.message || "Could not create campaign." }, { status: 400 });
  }

  const messages = contacts.map((contact) => ({
    campaign_id: campaign.id,
    supplier_contact_id: contact.id,
    supplier_code: contact.supplier_code,
    recipient_name: contact.contact_name || contact.supplier_name || "",
    recipient_phone: contact.whatsapp_phone_e164!,
    sender_key: sender.key,
    template_name: templateName,
    template_language: templateLanguage,
    template_parameters: renderWhatsAppTemplateParameters(bodyParameters, contact),
    status: mode === "semi_automatic" ? "AWAITING_APPROVAL" : "PENDING",
  }));

  let insertError: string | null = null;
  for (let index = 0; index < messages.length; index += 200) {
    const { error } = await ctx.supabase.from("whatsapp_messages").insert(messages.slice(index, index + 200));
    if (error) {
      insertError = error.message;
      break;
    }
  }
  if (insertError) {
    await ctx.supabase.from("whatsapp_messages").update({ status: "CANCELLED", error_message: "Campaign preparation failed before sending." }).eq("campaign_id", campaign.id);
    await ctx.supabase.from("whatsapp_campaigns").update({ status: "FAILED" }).eq("id", campaign.id);
    await ctx.supabase.from("audit_events").insert({
      actor_id: ctx.user.id, action: "WHATSAPP_CAMPAIGN_CREATE_FAILED",
      entity_type: "whatsapp_campaign", entity_id: campaign.id, metadata: { reason: insertError.slice(0, 300) },
    });
    return NextResponse.json({ error: "Campaign created, but the message queue could not be completed: " + insertError }, { status: 500 });
  }

  await ctx.supabase.from("audit_events").insert({
    actor_id: ctx.user.id,
    action: mode === "semi_automatic" ? "WHATSAPP_CAMPAIGN_AWAITING_APPROVAL" : "WHATSAPP_CAMPAIGN_QUEUED",
    entity_type: "whatsapp_campaign",
    entity_id: campaign.id,
    metadata: { total: contacts.length, senderKey, templateName, mode },
  });
  return NextResponse.json({ campaign, queued: mode === "automatic", recipientCount: contacts.length }, { status: 201 });
}
