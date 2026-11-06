import { NextResponse } from "next/server";
import { internalContext } from "@/lib/automation/auth";
export async function GET() {
  const ctx = await internalContext();
  if ("error" in ctx) return ctx.error;
  const { supabase } = ctx;
  const [items, contacts, fups] = await Promise.all([
    supabase.from("gcat_error_items").select("id,source_record_key,delivery_part_no,supplier_code,error_type_label").eq("source_status", "WORKING").is("judge", null).not("supplier_code", "is", null).order("supplier_code").limit(500),
    supabase.from("supplier_contacts").select("supplier_code").eq("active", true),
    supabase.from("supplier_followups").select("item_id,status").not("item_id", "is", null).in("status", ["COMPOSED", "SENT", "DRAFT"]),
  ]);
  const withContact = new Set((contacts.data || []).map((c) => c.supplier_code));
  const sent = new Map<string, string>();
  for (const f of fups.data || []) if (f.item_id && (sent.get(f.item_id) !== "SENT")) sent.set(f.item_id, f.status);
  const candidates = (items.data || []).map((r) => ({ ...r, hasContact: withContact.has(r.supplier_code), followup: sent.get(r.id) ?? null }));
  return NextResponse.json({ candidates });
}
