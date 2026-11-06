import { createClient } from "@/lib/supabase/server";

export type TrackerAuth = {
  supabase: NonNullable<Awaited<ReturnType<typeof createClient>>>;
  user: { id: string; email?: string | null };
  role: string;
};

export async function trackerAuth(allowed: string[] = ["admin", "preparer", "reviewer", "viewer"]) {
  const supabase = await createClient();
  if (!supabase) return { ok: false as const, status: 503, error: "Supabase is not configured." };
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return { ok: false as const, status: 401, error: "Authentication required." };
  const { data: profile, error } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (error || !profile?.role) return { ok: false as const, status: 403, error: "Workspace profile could not be verified." };
  if (!allowed.includes(profile.role)) return { ok: false as const, status: 403, error: "This action is not allowed for your workspace role." };
  return { ok: true as const, supabase, user: auth.user, role: profile.role };
}
