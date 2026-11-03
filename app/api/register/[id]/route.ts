import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const fields = ["assigned_person", "starting_date", "judgement_procedure", "judge", "ok_comment", "imds_reject_comment", "km_judge", "km_comment"] as const;
type RegisterField = typeof fields[number];

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid register item id." }, { status: 400 });
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Connect Supabase to save judgement changes." }, { status: 503 });
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role,display_name").eq("id", auth.user.id).maybeSingle();
  if (!profile) return NextResponse.json({ error: "Profile not found." }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "A JSON body is required." }, { status: 400 });
  const requested = fields.filter((key) => Object.prototype.hasOwnProperty.call(body, key));
  if (!requested.length) return NextResponse.json({ error: "No editable judgement fields were supplied." }, { status: 400 });
  const isKmEdit = requested.some((key) => key === "km_judge" || key === "km_comment");
  if (isKmEdit && !["admin", "reviewer"].includes(profile.role)) return NextResponse.json({ error: "Only TMA reviewer or admin can update KM Judge and KM Comment." }, { status: 403 });
  if (!isKmEdit && !["admin", "preparer", "reviewer"].includes(profile.role)) return NextResponse.json({ error: "Preparer, reviewer or admin role is required." }, { status: 403 });
  const update: Record<string, unknown> = {};
  for (const key of requested as RegisterField[]) {
    const value = body[key];
    if (value !== null && typeof value !== "string") return NextResponse.json({ error: `${key} must be text or null.` }, { status: 400 });
    update[key] = typeof value === "string" ? value.trim() || null : null;
  }
  if (typeof update.judge === "string" && !["OK", "NG"].includes(update.judge)) return NextResponse.json({ error: "Judge must be OK or NG." }, { status: 400 });
  if (typeof update.km_judge === "string" && !["OK", "NG"].includes(update.km_judge)) return NextResponse.json({ error: "KM Judge must be OK or NG." }, { status: 400 });
  if (typeof update.starting_date === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(update.starting_date)) return NextResponse.json({ error: "Starting date must use YYYY-MM-DD." }, { status: 400 });

  const { data: before, error: readError } = await supabase.from("gcat_error_items").select([...fields, "source_judge_label", "source_km_judge_label", "assigned_person_override", "starting_date_override", "judgement_procedure_override", "judge_override", "ok_comment_override", "imds_reject_comment_override", "km_judge_override", "km_comment_override", "last_change_date_override"].join(",")).eq("id", id).single();
  if (readError || !before) return NextResponse.json({ error: readError?.message || "Register row not found." }, { status: 404 });
  const beforeValues = before as unknown as Record<string, unknown>;
  // Only mark the field explicitly overridden when the user actually changed it.
  // Other AO–AV fields remain eligible for refresh from the next daily G-CATS snapshot.
  for (const key of requested as RegisterField[]) {
    if (beforeValues[key] !== update[key]) update[`${key}_override`] = true;
  }
  if ("judge" in update) update.judge_status = update.judge ?? null;
  update.last_change_date = new Date().toISOString();
  update.last_change_date_override = true;
  const { data, error } = await supabase.from("gcat_error_items").update(update).eq("id", id).select("id,source_record_key,error_type_label,delivery_part_no,supplier_code,assigned_person,starting_date,judgement_procedure,judge,ok_comment,imds_reject_comment,km_judge,km_comment,last_change_date").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 409 });
  const changedColumns = Object.keys(update);
  const after: Record<string, unknown> = {};
  for (const key of changedColumns) after[key] = update[key];
  await supabase.from("register_change_log").insert({ item_id: id, actor_id: auth.user.id, changed_columns: changedColumns, before_values: before, after_values: after });
  await supabase.from("audit_events").insert({ actor_id: auth.user.id, action: isKmEdit ? "KM_JUDGEMENT_UPDATED" : "JUDGEMENT_REGISTER_UPDATED", entity_type: "gcat_error_item", entity_id: id, metadata: { changedColumns } });
  return NextResponse.json({ item: data });
}
