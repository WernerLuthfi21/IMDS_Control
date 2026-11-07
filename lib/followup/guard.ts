/** Stops a double click on "send all" (or a second person's batch) from e-mailing the same supplier twice. */
export function recentlySent(lastSentAt: string | null | undefined, now: Date, gapHours: number): boolean {
  if (!lastSentAt || gapHours <= 0) return false;
  const t = Date.parse(lastSentAt);
  return !Number.isNaN(t) && now.getTime() - t < gapHours * 3600_000;
}
export function gapHoursFromEnv(v: string | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 24;
}
