/**
 * Due dates shared by everyone who uses the Tracker (settings key "due_dates"):
 *   models:    model key            -> yyyy-mm-dd  (the model's deadline, was browser-only before)
 *   suppliers: "COMPANY|model key"  -> yyyy-mm-dd  (a deadline for one supplier on one model; overrides the model's)
 * Anything that is not a real calendar date is dropped, never guessed.
 */
export type DueDates = { models: Record<string, string>; suppliers: Record<string, string> };
const MAX_ENTRIES = 5000;

export function validIso(v: unknown): string | null {
  const s = String(v ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) && Number(m[1]) >= 2000 && Number(m[1]) <= 2100 ? s : null;
}

function cleanMap(v: unknown, maxKey: number): Record<string, string> {
  const out: Record<string, string> = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  let n = 0;
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    const key = k.trim();
    const iso = validIso(raw);
    if (!key || key.length > maxKey || !iso) continue;
    out[key] = iso;
    if (++n >= MAX_ENTRIES) break;
  }
  return out;
}

export function sanitizeDueDates(v: unknown): DueDates {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const suppliers = cleanMap(o.suppliers, 240);
  for (const k of Object.keys(suppliers)) if (!/^[^|]+\|[^|]+$/.test(k)) delete suppliers[k];
  return { models: cleanMap(o.models, 120), suppliers };
}

export const supplierDueKey = (company: string, model: string) => `${String(company).trim().toUpperCase()}|${String(model).trim()}`;
