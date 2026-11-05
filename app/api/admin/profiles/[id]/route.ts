import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
const ROLES = ["admin", "preparer", "reviewer", "viewer", "supplier", "rule_author", "rule_approver"];

/** Admin-only: edit a user's display name, supplier code and role. Uses the admin's own session; RLS (profiles_update_admin) is the enforcement. */
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid user id." }, { status: 400 });
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { data: me } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (me?.role !== "admin") return NextResponse.json({ error: "Only an admin can edit users." }, { status: 403 });
  const body = await request.json().catch(() => null) as { display_name?: unknown; supplier_code?: unknown; role?: unknown } | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  const patch: Record<string, string | null> = {};
  if (body.display_name !== undefined) {
    const v = String(body.display_name).replace(/\s+/g, " ").trim();
    if (v.length > 60) return NextResponse.json({ error: "Display name is limited to 60 characters." }, { status: 422 });
    patch.display_name = v;
  }
  if (body.supplier_code !== undefined) {
    const v = String(body.supplier_code ?? "").trim().toUpperCase();
    if (v && !/^[A-Z0-9_-]{1,20}$/.test(v)) return NextResponse.json({ error: "Supplier code may contain letters, digits, - and _ only." }, { status: 422 });
    patch.supplier_code = v || null;
  }
  if (body.role !== undefined) {
    const v = String(body.role);
    if (!ROLES.includes(v)) return NextResponse.json({ error: "Unknown role." }, { status: 422 });
    if (id === auth.user.id && v !== "admin") return NextResponse.json({ error: "You cannot remove your own admin role." }, { status: 422 });
    patch.role = v;
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  const { data, error } = await supabase.from("profiles").update(patch).eq("id", id).select("id,email,display_name,role,supplier_code").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data) return NextResponse.json({ error: "User not found or not permitted." }, { status: 404 });
  return NextResponse.json({ profile: data });
}
