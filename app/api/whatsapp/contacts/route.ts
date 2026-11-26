import { NextRequest, NextResponse } from "next/server";
import { internalContext } from "@/lib/automation/auth";
import { sameOrigin } from "@/lib/security/request";

export async function GET() {
  const ctx = await internalContext();
  if ("error" in ctx) return ctx.error;
  const { data, error } = await ctx.supabase
    .from("supplier_contacts")
    .select("id,supplier_code,supplier_name,contact_name,email,active,whatsapp_phone_e164,whatsapp_opt_in,whatsapp_opt_in_at,whatsapp_opt_out_at")
    .eq("active", true)
    .order("supplier_name", { ascending: true })
    .limit(1000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const contacts = data || [];
  return NextResponse.json({
    contacts,
    eligibleCount: contacts.filter((contact) => contact.whatsapp_opt_in && contact.whatsapp_phone_e164).length,
  });
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request.headers)) return NextResponse.json({ error: "Request rejected." }, { status: 403 });
  const ctx = await internalContext();
  if ("error" in ctx) return ctx.error;
  if (!["admin", "preparer"].includes(ctx.profile.role)) {
    return NextResponse.json({ error: "Admin or preparer role required." }, { status: 403 });
  }
  const body = await request.json().catch(() => null) as {
    contactId?: string; phoneE164?: string; optIn?: boolean; consentSource?: string;
  } | null;
  if (!body?.contactId || typeof body.optIn !== "boolean") {
    return NextResponse.json({ error: "contactId and optIn are required." }, { status: 400 });
  }

  const phone = String(body.phoneE164 || "").trim();
  const normalized = phone ? "+" + phone.replace(/\D/g, "") : null;
  if (normalized && !/^\+[1-9]\d{7,14}$/.test(normalized)) {
    return NextResponse.json({ error: "Phone must be in international E.164 format, e.g. +628123456789." }, { status: 422 });
  }
  if (body.optIn && !normalized) {
    return NextResponse.json({ error: "A valid WhatsApp phone number is required before enabling opt-in." }, { status: 422 });
  }

  const { data: previous } = await ctx.supabase
    .from("supplier_contacts")
    .select("whatsapp_opt_in,whatsapp_phone_e164")
    .eq("id", body.contactId)
    .maybeSingle();
  const now = new Date().toISOString();
  const update: Record<string, unknown> = {
    whatsapp_phone_e164: normalized,
    whatsapp_opt_in: body.optIn,
    whatsapp_consent_source: body.optIn ? String(body.consentSource || "IMDS Control Center admin confirmation").slice(0, 120) : null,
  };
  if (body.optIn && (!previous?.whatsapp_opt_in || previous.whatsapp_phone_e164 !== normalized)) {
    update.whatsapp_opt_in_at = now;
    update.whatsapp_opt_out_at = null;
  }
  if (!body.optIn && previous?.whatsapp_opt_in) {
    update.whatsapp_opt_out_at = now;
  }
  const { data, error } = await ctx.supabase
    .from("supplier_contacts")
    .update(update)
    .eq("id", body.contactId)
    .select("id,supplier_code,contact_name,whatsapp_phone_e164,whatsapp_opt_in,whatsapp_opt_in_at,whatsapp_opt_out_at")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data) return NextResponse.json({ error: "Supplier contact not found." }, { status: 404 });
  await ctx.supabase.from("audit_events").insert({
    actor_id: ctx.user.id,
    action: body.optIn ? "WHATSAPP_CONTACT_OPTED_IN" : "WHATSAPP_CONTACT_OPTED_OUT",
    entity_type: "supplier_contact",
    entity_id: body.contactId,
    metadata: { phoneConfigured: !!normalized },
  });
  return NextResponse.json({ contact: data });
}
