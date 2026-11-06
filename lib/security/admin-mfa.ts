import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Admin users must have a verified TOTP factor and must satisfy AAL2 before
 * sensitive writes. Non-admin callers are rejected by the route before this helper.
 * Fail closed if Supabase cannot verify the factor or current assurance level.
 */
export async function needsMfaStepUp(supabase: SupabaseClient): Promise<boolean> {
  const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
  if (factorsError) return true;
  const verified = (factors?.totp || []).some((factor) => factor.status === "verified");
  if (!verified) return true;

  const { data: assurance, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assuranceError) return true;
  return assurance?.currentLevel !== "aal2";
}
