import { NextRequest, NextResponse } from "next/server";
import { internalContext } from "@/lib/automation/auth";
import { enqueue, dispatch } from "@/lib/automation/outbox";
import { flowConfig, renderFollowup, transportFor } from "@/lib/automation/flow";
export const maxDuration = 60;

/** Sends ONE supplier e-mail through Power Automate. The browser calls this once per selected row, in order. */
export async function POST(request: NextRequest) {
  const ctx = await internalContext();
  if ("error" in ctx) return ctx.error;
  if (!["admin", "preparer"].includes(ctx.profile.role)) return NextResponse.json({ error: "Preparer or admin role required to send supplier e-mail." }, { status: 403 });
  if (!transportFor("SUPPLIER_EMAIL", flowConfig())) return NextResponse.json({ error: "No supplier e-mail transport is configured (POWER_AUTOMATE_EMAIL_URL or the FLOW_SMTP_* mail settings). Nothing was sent.", status: "NOT_CONFIGURED" }, { status: 503 });
  const body = await request.json().catch(() => null) as { itemId?: string } | null;
  const itemId = body?.itemId;
  if (!itemId || !/^[0-9a-f-]{36}$/i.test(itemId)) return NextResponse.json({ error: "itemId is required." }, { status: 400 });
  const { supabase, user } = ctx;
  const { data: item } = await supabase.from("gcat_error_items").select("id,supplier_code,delivery_part_no,error_type_label").eq("id", itemId).maybeSingle();
  if (!item?.supplier_code || !item.delivery_part_no) return NextResponse.json({ error: "Record has no supplier code or part number.", status: "SKIPPED" }, { status: 422 });
  const { data: contacts } = await supabase.from("supplier_contacts").select("email,supplier_name").eq("supplier_code", item.supplier_code).eq("active", true).order("created_at").limit(1);
  const contact = contacts?.[0];
  if (!contact) return NextResponse.json({ error: `No active contact for ${item.supplier_code}. Add the PIC first.`, status: "SKIPPED" }, { status: 422 });
  const [{ data: dup }, { data: handed }] = await Promise.all([
    supabase.from("supplier_followups").select("id").eq("item_id", itemId).eq("status", "SENT").limit(1),
    supabase.from("sync_outbox").select("id").eq("item_id", itemId).eq("kind", "SUPPLIER_EMAIL").eq("status", "SENT").limit(1),
  ]);
  if (dup?.length || handed?.length) return NextResponse.json({ error: "A follow-up for this record was already sent.", status: "SKIPPED" }, { status: 409 });
  const msg = renderFollowup({ errorType: item.error_type_label || "", supplierName: contact.supplier_name, supplierCode: item.supplier_code, partNo: item.delivery_part_no });
  const { data: f, error } = await supabase.from("supplier_followups").insert({ item_id: itemId, supplier_code: item.supplier_code, recipient_email: contact.email, subject: msg.subject, message_body: msg.body, status: "COMPOSED", composed_at: new Date().toISOString(), created_by: user.id }).select("id").single();
  if (error || !f) return NextResponse.json({ error: error?.message || "Could not create follow-up.", status: "FAILED" }, { status: 400 });
  await enqueue(supabase, user.id, { kind: "SUPPLIER_EMAIL", followupId: f.id, itemId });
  const r = await dispatch(supabase, { kind: "SUPPLIER_EMAIL", followupId: f.id, limit: 1 });
  await supabase.from("audit_events").insert({ actor_id: user.id, action: r.sent ? "SUPPLIER_FOLLOWUP_SENT_VIA_FLOW" : "SUPPLIER_FOLLOWUP_SEND_FAILED", entity_type: "supplier_followup", entity_id: f.id, metadata: { supplierCode: item.supplier_code, recipient: contact.email } });
  return NextResponse.json({ status: r.sent ? "SENT" : "FAILED", followupId: f.id, to: contact.email, note: r.sent ? (flowConfig().emailUrl ? "Accepted by the Power Automate flow (HTTP 2xx)." : "Handed to your Outlook inbox; the flow sends it. Not yet confirmed as sent by Outlook.") : "The transport did not accept it; it stays queued and can be retried." }, { status: r.sent ? 200 : 502 });
}
