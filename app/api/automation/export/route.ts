import { NextResponse } from "next/server";
import { internalContext } from "@/lib/automation/auth";
import { buildExcelPayload, toCsv, type RegisterRow } from "@/lib/automation/flow";

const COLS = "source_record_key,error_type_label,delivery_part_no,supplier_code,assigned_person,starting_date,judgement_procedure,judge,ok_comment,imds_reject_comment,km_judge,km_comment,last_change_date";
/** One-time seed: the current WORKING register as CSV in the exact column order of the Excel table. */
export async function GET() {
  const ctx = await internalContext();
  if ("error" in ctx) return ctx.error;
  if (!["admin", "preparer"].includes(ctx.profile.role)) return NextResponse.json({ error: "Preparer or admin role required." }, { status: 403 });
  const { data, error } = await ctx.supabase.from("gcat_error_items").select(COLS).eq("source_status", "WORKING").order("source_record_key").limit(8000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await ctx.supabase.from("audit_events").insert({ actor_id: ctx.user.id, action: "REGISTER_SEED_EXPORT", entity_type: "gcat_error_item", entity_id: null, metadata: { rows: data?.length ?? 0 } });
  return new NextResponse(toCsv((data || []).map((r) => buildExcelPayload(r as unknown as RegisterRow))), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="judgement-register-seed.csv"', "Cache-Control": "no-store" } });
}
