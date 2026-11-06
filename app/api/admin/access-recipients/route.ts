import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

async function adminContext() {
  const supabase = await createClient();
  if (!supabase) return { error: NextResponse.json({ error: "Supabase is not configured." }, { status: 503 }) } as const;
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: NextResponse.json({ error: "Authentication required." }, { status: 401 }) } as const;
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
  if (profile?.role !== "admin") return { error: NextResponse.json({ error: "Admin access required." }, { status: 403 }) } as const;
  const { needsMfaStepUp } = await import("@/lib/security/admin-mfa");
  if (await needsMfaStepUp(supabase)) return { error: NextResponse.json({ error: "Complete authenticator verification before changing approval recipients." }, { status: 403, headers: { "x-auth-reason": "mfa_required" } }) } as const;
  return { supabase, user: data.user } as const;
}

export async function POST(request: NextRequest) {
  const ctx = await adminContext();
  if ("error" in ctx) return ctx.error;
  const body = await request.json().catch(() => null) as { email?: unknown; displayName?: unknown } | null;
  const email = String(body?.email ?? "").trim().toLowerCase();
  const displayName = String(body?.displayName ?? "").trim().slice(0, 100);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 422 });
  const { data, error } = await ctx.supabase.from("access_approval_recipients").upsert({ email, display_name: displayName || null, active: true, created_by: ctx.user.id }, { onConflict: "email" }).select("id,email,display_name,active").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ recipient: data });
}

export async function DELETE(request: NextRequest) {
  const ctx = await adminContext();
  if ("error" in ctx) return ctx.error;
  const id = request.nextUrl.searchParams.get("id");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid recipient id." }, { status: 400 });
  const { error } = await ctx.supabase.from("access_approval_recipients").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
