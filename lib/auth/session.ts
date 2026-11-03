import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type AuthContext = {
  configured: boolean;
  userId: string | null;
  email: string | null;
  role: string | null;
  roleError: boolean;
};

/**
 * One auth + role lookup per request, shared by layout, pages and route handlers.
 * getClaims() verifies the JWT locally when the project uses asymmetric signing keys
 * (and falls back to an Auth server call otherwise), instead of a network round trip every time.
 */
export const getAuthContext = cache(async (): Promise<AuthContext> => {
  const supabase = await createClient();
  if (!supabase) return { configured: false, userId: null, email: null, role: null, roleError: false };
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return { configured: true, userId: null, email: null, role: null, roleError: false };
  const { data: profile, error } = await supabase.from("profiles").select("role").eq("id", claims.sub).maybeSingle();
  return {
    configured: true,
    userId: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
    role: profile?.role ?? null,
    roleError: Boolean(error)
  };
});
