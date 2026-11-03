import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
export async function GET() {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ followups: [], mode: "local-preview" });
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { data, error } = await supabase.from("supplier_followups").select("id,item_id,supplier_code,recipient_email,subject,message_body,status,created_at,composed_at").order("created_at", { ascending: false }).limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ followups: data || [] });
}
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Persistent follow-up requires Supabase." }, { status: 503 });
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (!profile || !["admin", "preparer", "reviewer"].includes(profile.role)) return NextResponse.json({ error: "Internal preparer role required." }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const supplierCode = String(body.supplierCode || "").trim();
  const recipient = String(body.recipientEmail || "").trim();
  const subject = String(body.subject || "").trim();
  const message = String(body.messageBody || "").trim();
  if (!supplierCode || !recipient.includes("@") || !subject || !message) return NextResponse.json({ error: "Supplier code, valid recipient, subject and message are required." }, { status: 422 });
  const itemId = typeof body.itemId === "string" && /^[0-9a-f-]{36}$/i.test(body.itemId) ? body.itemId : null;
  if (typeof body.itemId === "string" && !itemId) return NextResponse.json({ error: "Invalid itemId." }, { status: 400 });
  if (itemId) {
    const { data: item, error: itemError } = await supabase.from("gcat_error_items").select("supplier_code,delivery_part_no,error_type_label").eq("id", itemId).single();
    if (itemError || !item) return NextResponse.json({ error: "Linked G-CATS record was not found." }, { status: 404 });
    if (item.supplier_code !== supplierCode) return NextResponse.json({ error: "Supplier code does not match the selected G-CATS record." }, { status: 422 });
  }
  const { data, error } = await supabase.from("supplier_followups").insert({ item_id: itemId, supplier_code: supplierCode, recipient_email: recipient, cc_emails: Array.isArray(body.ccEmails) ? body.ccEmails.filter(x => typeof x === "string") as string[] : [], subject, message_body: message, status: "COMPOSED", created_by: auth.user.id, composed_at: new Date().toISOString() }).select("id,item_id,supplier_code,recipient_email,subject,status,created_at").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await supabase.from("audit_events").insert({ actor_id: auth.user.id, action: "SUPPLIER_FOLLOWUP_COMPOSED", entity_type: "supplier_followup", entity_id: data.id, metadata: { supplierCode, recipient } });
  return NextResponse.json({ followup: data }, { status: 201 });
}
