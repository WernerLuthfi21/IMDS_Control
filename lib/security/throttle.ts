import type { SupabaseClient } from "@supabase/supabase-js";

/** Records one hit and returns true when the caller is over the limit. Fails closed only for the counter, never leaks details. */
export async function overLimit(admin: SupabaseClient, bucket: string, keyHash: string, max: number, windowSeconds: number) {
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const { count } = await admin.from("security_throttle").select("id", { count: "exact", head: true }).eq("bucket", bucket).eq("key_hash", keyHash).gte("created_at", since);
  await admin.from("security_throttle").insert({ bucket, key_hash: keyHash });
  if (Math.random() < 0.02) await admin.from("security_throttle").delete().lt("created_at", new Date(Date.now() - 2 * 86400000).toISOString());
  return (count ?? 0) >= max;
}
