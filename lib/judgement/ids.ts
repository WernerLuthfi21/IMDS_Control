/** Register-record ids accepted by one judgement API request. */
export const MAX_IDS_PER_REQUEST = 250;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validate a list of register-record ids for a judgement request.
 * Duplicates are collapsed (first occurrence wins, order kept) instead of failing the
 * whole request: a repeated id carries no extra meaning and used to block every pending
 * case when the page list contained the same row twice. Returns null when the list is
 * empty, too long, or contains anything that is not a UUID.
 */
export function validIds(value: unknown, max = MAX_IDS_PER_REQUEST): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > max) return null;
  if (value.some((id) => typeof id !== "string" || !UUID.test(id))) return null;
  return [...new Set(value as string[])];
}

/** Keep the first row per id, order unchanged. */
export function uniqueById<T>(rows: T[]): T[] {
  const seen = new Set<unknown>();
  return rows.filter((row) => {
    const id = (row as { id?: unknown }).id;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
