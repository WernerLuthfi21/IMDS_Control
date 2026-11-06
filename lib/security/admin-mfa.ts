import type { SupabaseClient } from "@supabase/supabase-js";

/** Require an AAL2 session for sensitive admin writes when the account has MFA enrolled. */
export async function needsMfaStepUp(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) return true;
  return data?.nextLevel === "aal2" && data.currentLevel !== "aal2";
}
