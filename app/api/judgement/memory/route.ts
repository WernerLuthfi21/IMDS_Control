import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isMemoryField, rememberForPart } from "@/lib/judgement/memory";

export const runtime = "nodejs";
const EDIT_ROLES = ["admin", "preparer", "reviewer"];

/** Remember one Toyota-owned answer for a delivery part so identical cases are not asked again. */
export async function PUT(request: NextRequest) {
  const auth = await getAuthContext();
  if (!auth.configured) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  if (!auth.userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!EDIT_ROLES.includes(auth.role || "")) return NextResponse.json({ error: "Preparer, reviewer or admin role is required." }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const field = typeof body?.field === "string" ? body.field : "";
  const value = typeof body?.value === "string" ? body.value : "";
  const partNo = typeof body?.partNo === "string" ? body.partNo : "";
  const itemId = typeof body?.itemId === "string" && /^[0-9a-f-]{36}$/i.test(body.itemId) ? body.itemId : undefined;
  if (!isMemoryField(field)) return NextResponse.json({ error: "This answer cannot be remembered." }, { status: 400 });
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const r = await rememberForPart(supabase, { partNo, field, value, userId: auth.userId, userName: auth.displayName || auth.email || "Reviewer", itemId });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 422 });
  await supabase.from("audit_events").insert({ actor_id: auth.userId, action: "JUDGEMENT_MEMORY_SET", entity_type: "judgement_memory", metadata: { partNo, field, value, itemId: itemId || null } });
  return NextResponse.json({ ok: true });
}
