import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { enqueuePartMasterRows, dispatchPartMasterOutbox } from "@/lib/imds-master/outbox";

export const dynamic = "force-dynamic";

const EDITABLE_FIELDS = [
  "project", "vendor_code", "main_pic_email", "company_name", "part_name", "part_no",
  "submission_plan", "supplier_promise_date", "imds_status", "imds_id_version", "part_status", "have_respond_email",
  "status_update", "md_id_version", "md_status_update_date", "comment", "lpop_confirmation", "cek"
] as const;
type EditableField = typeof EDITABLE_FIELDS[number];

function normalizePartNo(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const DATE_FIELDS = new Set<EditableField>(["submission_plan", "supplier_promise_date", "md_status_update_date"]);

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthContext();
  if (!auth.configured) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  if (!auth.userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!["admin", "preparer", "reviewer"].includes(auth.role || "")) {
    return NextResponse.json({ error: "Admin, preparer or reviewer role is required to edit master data." }, { status: 403 });
  }

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid master row id." }, { status: 400 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "A JSON body is required." }, { status: 400 });

  const requested = EDITABLE_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(body, field));
  if (!requested.length) return NextResponse.json({ error: "No editable fields were supplied." }, { status: 400 });

  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });

  const { data: before, error: readError } = await supabase.from("imds_master_parts")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (readError || !before) return NextResponse.json({ error: readError?.message || "Master part not found." }, { status: 404 });

  const update: Record<string, unknown> = { updated_by: auth.userId };
  for (const field of requested as EditableField[]) {
    const value = body[field];
    if (DATE_FIELDS.has(field)) {
      if (value !== null && value !== "" && (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))) {
        return NextResponse.json({ error: `${field} must use YYYY-MM-DD.` }, { status: 422 });
      }
      update[field] = value || null;
    } else {
      if (value !== null && typeof value !== "string") {
        return NextResponse.json({ error: `${field} must be text or null.` }, { status: 422 });
      }
      update[field] = typeof value === "string" ? value.trim() || null : null;
    }
  }

  if (typeof update.part_no === "string") update.part_no_norm = normalizePartNo(update.part_no);
  if (Object.prototype.hasOwnProperty.call(update, "supplier_promise_date")) {
    update.supplier_promise_updated_at = new Date().toISOString();
  }

  const overrides = new Set<string>(Array.isArray(before.manual_overrides) ? before.manual_overrides.map(String) : []);
  requested.forEach((field) => overrides.add(field));
  update.manual_overrides = [...overrides];

  const { data, error } = await supabase.from("imds_master_parts")
    .update(update)
    .eq("id", id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 409 });

  await supabase.from("audit_events").insert({
    actor_id: auth.userId,
    action: "IMDS_MASTER_PART_UPDATED",
    entity_type: "imds_master_part",
    entity_id: id,
    metadata: { changedColumns: requested, masterKey: data.master_key }
  });

  let powerAutomate;
  try {
    await enqueuePartMasterRows(supabase, auth.userId, [data as Record<string, unknown>], "manual_master_edit");
    powerAutomate = await dispatchPartMasterOutbox(supabase, 10);
  } catch (syncError) {
    powerAutomate = { configured: Boolean(process.env.POWER_AUTOMATE_TRACKER_URL?.trim()), sent: 0, failed: 0, pending: 1, error: syncError instanceof Error ? syncError.message : "Master sync could not be queued." };
  }

  return NextResponse.json({ row: data, powerAutomate }, { headers: { "Cache-Control": "no-store" } });
}
