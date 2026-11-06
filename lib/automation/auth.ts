import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function internalContext() {
  const supabase = await createClient();
  if (!supabase) return { error: NextResponse.json({ error: "Connect Supabase first." }, { status: 503 }) } as const;
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: NextResponse.json({ error: "Authentication required." }, { status: 401 }) } as const;
  const { data: profile } = await supabase.from("profiles").select("role,display_name").eq("id", auth.user.id).maybeSingle();
  if (!profile || !["admin", "preparer", "reviewer"].includes(profile.role)) return { error: NextResponse.json({ error: "Internal role required." }, { status: 403 }) } as const;
  return { supabase, user: auth.user, profile } as const;
}
