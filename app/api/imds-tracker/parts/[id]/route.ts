import { NextRequest, NextResponse } from "next/server";
import { trackerAuth } from "@/lib/imds-tracker/auth";
import { pushTrackerToPowerAutomate } from "@/lib/imds-tracker/bridge";

export const runtime = "nodejs";
const EDITABLE = new Set([
  "project","vendor_code","main_pic_email","company_name","part_name","part_no","submission_plan",
  "imds_status","imds_id_version","part_status","have_respond_email","status_update","md_id_version",
  "md_status_update_date","comment","lpop_confirmation","cek","supplier_promise_date"
]);
const DATE_FIELDS = new Set(["submission_plan","md_status_update_date","supplier_promise_date"]);

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await trackerAuth(["admin", "preparer", "reviewer"]);
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid master row id." }, { status: 400 });
  const body = await request.json().catch(() => null) as { field?: string; value?: unknown; resetOverride?: boolean } | null;
  if (!body?.field || !EDITABLE.has(body.field)) return NextResponse.json({ error: "Choose a supported master field to update." }, { status: 400 });
  const field = body.field;
  const { data: before, error: readError } = await ctx.supabase.from("imds_master_parts")
    .select("*").eq("id", id).maybeSingle();
  if (readError || !before) return NextResponse.json({ error: readError?.message || "Master part not found." }, { status: 404 });

  const currentOverrides = Array.isArray(before.manual_overrides) ? before.manual_overrides.map(String) : [];
  const nextOverrides = new Set(currentOverrides);
  const patch: Record<string, unknown> = { updated_by: ctx.user.id };
  if (body.resetOverride) {
    nextOverrides.delete(field);
    // Revert to the most recent imported source cell when that original header is available.
    const sourceHeader: Record<string, string> = {
      project: "PROJECT", vendor_code: "VENDOR CODE", main_pic_email: "MAIN PIC EMAIL",
      company_name: "COMPANY NAME", part_name: "PART NAME", part_no: "P/No.",
      submission_plan: "SUBMISSION PLAN", imds_status: "IMDS STATUS", imds_id_version: "ID / Ver",
      part_status: "Part Status", have_respond_email: "Have respond email", status_update: "STATUS UPDATE",
      md_id_version: "ID/Ver", md_status_update_date: "Date", comment: "Comment",
      lpop_confirmation: "LPOP Confirmation", cek: "CEK"
    };
    const original = (before.extra_fields || {})[sourceHeader[field]];
    patch[field] = DATE_FIELDS.has(field) ? (typeof original === "string" && /^\d{4}-\d{2}-\d{2}/.test(original) ? original.slice(0,10) : null) : (original === null || original === undefined || original === "" ? null : String(original));
  } else {
    const value = body.value;
    if (value !== null && value !== undefined && typeof value !== "string") return NextResponse.json({ error: "Field values must be text or null." }, { status: 422 });
    const text = typeof value === "string" ? value.trim() : null;
    if (DATE_FIELDS.has(field) && text && !/^\d{4}-\d{2}-\d{2}$/.test(text)) return NextResponse.json({ error: "Date fields must use YYYY-MM-DD." }, { status: 422 });
    patch[field] = text || null;
    nextOverrides.add(field);
  }
  patch.manual_overrides = [...nextOverrides];
  if (field === "supplier_promise_date") patch.supplier_promise_updated_at = new Date().toISOString();
  const { data, error } = await ctx.supabase.from("imds_master_parts").update(patch).eq("id", id).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 409 });

  await ctx.supabase.from("audit_events").insert({
    actor_id: ctx.user.id, action: "IMDS_MASTER_PART_UPDATED", entity_type: "imds_master_part", entity_id: id,
    metadata: { field, resetOverride: Boolean(body.resetOverride), masterKey: before.master_key }
  });
  const powerAutomate = await pushTrackerToPowerAutomate({
    type: "imds_tracker_part_upsert",
    masterKey: data.master_key,
    fields: { [field]: data[field] },
    row: data
  });
  return NextResponse.json({ part: data, powerAutomate }, { headers: { "Cache-Control": "no-store" } });
}
