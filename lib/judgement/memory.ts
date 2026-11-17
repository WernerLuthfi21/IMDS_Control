import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * "The system remembers": answers Toyota gave once for a delivery part (vehicle destination,
 * mass tolerance class from the drawing, Toyota-owned flow answers) are reused for the next
 * identical case instead of asking again. Supplier answers stay in supplier_confirmations.
 */
export const MEMORY_FIELDS = ["destination", "toleranceClass", "usCarpet", "nonEuReq"] as const;
export type MemoryField = (typeof MEMORY_FIELDS)[number];
export type MemoryEntry = { field: MemoryField; value: string; setByName: string | null; source: string; updatedAt: string };
export type PartMemory = Partial<Record<MemoryField, MemoryEntry>>;

const VALID: Record<MemoryField, RegExp> = {
  destination: /^(EU|KR|CN|TW|IN|JP|OTH)$/,
  toleranceClass: /^M[A-F]$/,
  usCarpet: /^[YN]$/,
  nonEuReq: /^[YN]$/
};

export function partKey(partNo: string | null | undefined): string {
  return String(partNo || "").trim().toUpperCase().replace(/\s+/g, "").slice(0, 80);
}
export function isMemoryField(field: string): field is MemoryField {
  return (MEMORY_FIELDS as readonly string[]).includes(field);
}
export function validMemoryValue(field: MemoryField, value: string): boolean {
  return VALID[field].test(value);
}

/** Missing table (migration not applied yet) is not an error: memory is simply empty. */
export const MEMORY_TABLE_MISSING = /judgement_memory|relation .* does not exist|schema cache/i;

export async function loadPartMemory(supabase: SupabaseClient, partNos: string[]): Promise<{ map: Map<string, PartMemory>; available: boolean }> {
  const keys = [...new Set(partNos.map(partKey).filter(Boolean))];
  const map = new Map<string, PartMemory>();
  if (!keys.length) return { map, available: true };
  for (let i = 0; i < keys.length; i += 200) {
    const { data, error } = await supabase.from("judgement_memory")
      .select("scope_key,field,value,set_by_name,source,updated_at")
      .eq("scope", "part").in("scope_key", keys.slice(i, i + 200));
    if (error) {
      if (MEMORY_TABLE_MISSING.test(error.message)) return { map, available: false };
      throw new Error(error.message);
    }
    for (const row of data || []) {
      if (!isMemoryField(row.field) || !validMemoryValue(row.field, row.value)) continue;
      const m = map.get(row.scope_key) ?? {};
      m[row.field] = { field: row.field, value: row.value, setByName: row.set_by_name, source: row.source, updatedAt: row.updated_at };
      map.set(row.scope_key, m);
    }
  }
  return { map, available: true };
}

export async function rememberForPart(supabase: SupabaseClient, input: { partNo: string; field: MemoryField; value: string; userId: string; userName: string; itemId?: string; source?: "reviewer" | "system" }) {
  const key = partKey(input.partNo);
  if (!key) return { ok: false as const, error: "This case has no delivery part number to remember the answer for." };
  if (!validMemoryValue(input.field, input.value)) return { ok: false as const, error: "Invalid value." };
  const { error } = await supabase.from("judgement_memory").upsert({
    scope: "part", scope_key: key, field: input.field, value: input.value, source: input.source || "reviewer",
    set_by: input.userId, set_by_name: input.userName, source_item_id: input.itemId || null, updated_at: new Date().toISOString()
  }, { onConflict: "scope,scope_key,field" });
  if (error) return { ok: false as const, error: MEMORY_TABLE_MISSING.test(error.message) ? "Memory is not available yet: run migration 20261118000000_judgement_memory_autojudge.sql." : error.message };
  return { ok: true as const };
}

/** Plain-language provenance shown next to a remembered answer. */
export function describeMemory(entry: MemoryEntry): string {
  const who = entry.source === "system" ? "the system" : entry.setByName || "a reviewer";
  return `Remembered from ${who} on ${entry.updatedAt.slice(0, 10)}`;
}
