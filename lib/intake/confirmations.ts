import type { SupabaseClient } from "@supabase/supabase-js";
import { partKey, supplierKey } from "@/lib/intake/keys";

export type StoredConfirmation = { supplier_code: string; delivery_part_no: string; answers: Record<string, string>; submitted_at: string; source_file_name: string | null };
export type Family = "substance" | "pb" | "mass" | "sms" | "app44" | "warp";

export function familyOfKind(kind: string): Family | null {
  // ELV Cd/Hg/Cr6+ answers are the same supplier questions as substances, stored per CAS.
  if (kind === "elv") return "substance";
  return kind === "substance" || kind === "pb" || kind === "mass" || kind === "sms" || kind === "app44" || kind === "warp" ? kind : null;
}

/** Latest supplier confirmation for this part (same supplier code, same family, same CAS). Returns null when none or when the table is not migrated yet. */
export async function loadConfirmation(supabase: SupabaseClient, item: { supplier_code: string | null; delivery_part_no: string | null }, family: Family, cas: string): Promise<StoredConfirmation | null> {
  if (!item.delivery_part_no || !item.supplier_code) return null;
  const { data, error } = await supabase.from("supplier_confirmations")
    .select("supplier_code,delivery_part_no,answers,submitted_at,source_file_name")
    .eq("part_key", partKey(item.delivery_part_no)).eq("family", family).eq("cas", family === "substance" ? cas : "")
    .order("submitted_at", { ascending: false }).limit(5);
  if (error || !data) return null; // missing table / RLS: behave as "no confirmation"
  const mine = supplierKey(item.supplier_code);
  const hit = data.find((d) => supplierKey(d.supplier_code) === mine);
  return hit ? (hit as StoredConfirmation) : null;
}

/** All confirmations for these parts in one query; look them up with `pickConfirmation`. Null when the table is unavailable. */
export async function loadConfirmationsFor(supabase: SupabaseClient, partNos: Array<string | null | undefined>): Promise<StoredConfirmation[] | null> {
  const keys = [...new Set(partNos.map((p) => partKey(p ?? "")).filter(Boolean))];
  if (!keys.length) return [];
  const out: StoredConfirmation[] = [];
  for (let i = 0; i < keys.length; i += 200) {
    const { data, error } = await supabase.from("supplier_confirmations")
      .select("supplier_code,delivery_part_no,answers,submitted_at,source_file_name,part_key,family,cas")
      .in("part_key", keys.slice(i, i + 200)).order("submitted_at", { ascending: false });
    if (error || !data) return null;
    out.push(...(data as unknown as StoredConfirmation[]));
  }
  return out;
}
/** Same answer as `loadConfirmation`, from rows already loaded with `loadConfirmationsFor`. */
export function pickConfirmation(all: StoredConfirmation[], item: { supplier_code: string | null; delivery_part_no: string | null }, family: Family, cas: string): StoredConfirmation | null {
  if (!item.delivery_part_no || !item.supplier_code) return null;
  const pk = partKey(item.delivery_part_no), mine = supplierKey(item.supplier_code), c = family === "substance" ? cas : "";
  return all.find((d) => {
    const r = d as StoredConfirmation & { part_key?: string; family?: string; cas?: string };
    return r.part_key === pk && r.family === family && (r.cas ?? "") === c && supplierKey(d.supplier_code) === mine;
  }) ?? null;
}

export function describeAnswers(a: Record<string, string>): string {
  return Object.entries(a).map(([k, v]) => `${k}=${v}`).join(", ");
}
