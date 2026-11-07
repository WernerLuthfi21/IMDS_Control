import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cleanText, normalizeEmail, validEmail } from "@/lib/access/validate";
import { sameOrigin } from "@/lib/security/request";

/** Admin-only list of PICs who get the "request waiting" email. RLS (approval_recipients_admin_all) is the enforcement. */
async function adminCtx(request: NextRequest) {
  if (!sameOrigin(request.headers)) return { error: NextResponse.json({ error: "Request rejected." }, { status: 403 }) } as const;
  const supabase = await createClient();
  if (!supabase) return { error: NextResponse.json({ error: "Supabase is not configured." }, { status: 503 }) } as const;
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: NextResponse.json({ error: "Authentication required." }, { status: 401 }) } as const;
  const { data: me } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (me?.role !== "admin") return { error: NextResponse.json({ error: "Admin only." }, { status: 403 }) } as const;
  return { supabase, userId: auth.user.id } as const;
}

export async function POST(request: NextRequest) {
  const c = await adminCtx(request); if ("error" in c) return c.error;
  const b = await request.json().catch(() => null) as { email?: unknown; name?: unknown } | null;
  const email = normalizeEmail(b?.email);
  if (!validEmail(email)) return NextResponse.json({ error: "Enter a valid email." }, { status: 422 });
  const { data, error } = await c.supabase.from("approval_recipients").insert({ email, display_name: cleanText(b?.name, 60) || null, created_by: c.userId }).select("id,email,display_name,active").single();
  if (error) return NextResponse.json({ error: error.code === "23505" ? "This email is already in the list." : error.message }, { status: 400 });
  return NextResponse.json({ recipient: data });
}
export async function PATCH(request: NextRequest) {
  const c = await adminCtx(request); if ("error" in c) return c.error;
  const b = await request.json().catch(() => null) as { id?: string; active?: boolean } | null;
  if (!b?.id || !/^[0-9a-f-]{36}$/i.test(b.id) || typeof b.active !== "boolean") return NextResponse.json({ error: "id and active are required." }, { status: 400 });
  const { error } = await c.supabase.from("approval_recipients").update({ active: b.active }).eq("id", b.id);
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ ok: true });
}
export async function DELETE(request: NextRequest) {
  const c = await adminCtx(request); if ("error" in c) return c.error;
  const id = request.nextUrl.searchParams.get("id") || "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  const { error } = await c.supabase.from("approval_recipients").delete().eq("id", id);
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ ok: true });
}
