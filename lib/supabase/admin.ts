import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * SERVER-ONLY. Uses SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS. Import this file only from route handlers.
 * Never import it from a "use client" component and never prefix the variable with NEXT_PUBLIC_.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
