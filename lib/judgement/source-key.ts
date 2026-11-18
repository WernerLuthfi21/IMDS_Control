/**
 * Stable identity for a G-CATS Error Log row.
 *
 * The `code` column is filled only after TMA has judged a case (TMA returns code + KM judge/comment).
 * A blank code therefore means "not judged by TMA yet". It does not mean "no identity".
 * In every coded row of the Master Data (4,841 of 4,841, checked 2026-11-19), the code is exactly
 * Download Date (YYYYMMDD) followed by No. padded to 3 digits. So an uncoded row gets the same key now
 * that TMA's code will give it later: no new record when TMA codes it, and the Excel flow finds the row.
 * Before this, an uncoded row got `fallback:<file hash>:<sheet>:<row>`. That key changed with every
 * export, so judgements on those rows never matched again.
 */
export type KeyOrigin = "tma" | "derived" | "fallback";

/** yyyy-mm-dd from a JS Date, an Excel serial, "yyyy-mm-dd…", or "yyyy/mm/dd". */
export function sourceDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10);
  if (typeof v === "string") {
    const m = /^\s*(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(v);
    if (m) {
      const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  return null;
}

/** "20261105" + "007" — null when either part is missing or No. is not 1–999. */
export function derivedSourceCode(downloadDate: unknown, sequenceNo: unknown): string | null {
  const d = sourceDate(downloadDate);
  const n = typeof sequenceNo === "number" ? sequenceNo : Number(String(sequenceNo ?? "").trim());
  if (!d || !Number.isInteger(n) || n < 1 || n > 999) return null;
  return d.replace(/-/g, "") + String(n).padStart(3, "0");
}

export function recordKey(code: string, downloadDate: unknown, sequenceNo: unknown, fallback: string): { key: string; origin: KeyOrigin; derived: string | null } {
  const derived = derivedSourceCode(downloadDate, sequenceNo);
  if (code.trim()) return { key: `code:${code.trim()}`, origin: "tma", derived };
  if (derived) return { key: `code:${derived}`, origin: "derived", derived };
  return { key: fallback, origin: "fallback", derived: null };
}
