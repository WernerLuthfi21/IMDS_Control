import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Connect Supabase to apply bulk preparation." }, { status: 503 });
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (!profile || !["admin", "preparer", "reviewer"].includes(profile.role)) {
    return NextResponse.json({ error: "Preparer, reviewer or admin role is required." }, { status: 403 });
  }
  const body = await request.json().catch(() => null) as { ids?: unknown; assigned_person?: unknown; starting_date?: unknown; judgement_procedure?: unknown } | null;
  if (!body || !Array.isArray(body.ids) || body.ids.length < 2 || body.ids.length > 100 || !body.ids.every((id) => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id))) {
    return NextResponse.json({ error: "Select between 2 and 100 valid records." }, { status: 400 });
  }
  const ids = [...new Set(body.ids as string[])];
  if (ids.length !== body.ids.length) return NextResponse.json({ error: "Duplicate record IDs were supplied." }, { status: 400 });
  const values: Record<string, string> = {};
  for (const key of ["assigned_person", "starting_date", "judgement_procedure"] as const) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    if (typeof body[key] !== "string") return NextResponse.json({ error: `${key} must be text.` }, { status: 400 });
    const value = body[key].trim();
    if (value) values[key] = value;
  }
  if (!Object.keys(values).length) return NextResponse.json({ error: "Enter at least one preparation field to apply." }, { status: 422 });
  const { data, error } = await supabase.rpc("bulk_prepare_gcat_items", { p_item_ids: ids, p_values: values });
  if (error) return NextResponse.json({ error: error.message }, { status: 409 });
  return NextResponse.json(data);
}
