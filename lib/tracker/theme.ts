// Tracker preference never writes the Judgement imds-theme key.
export const TRACKER_THEME_KEY = "imds-tracker-theme";
export type TrackerTheme = "light" | "dark" | "system";
export function normalizeTrackerTheme(value: string | null, legacyValue: string | null = null): TrackerTheme {
  const preferred = value ?? legacyValue;
  return preferred === "light" || preferred === "dark" ? preferred : "system";
}
export function resolveTrackerTheme(value: TrackerTheme, dark: boolean): "light" | "dark" {
  return value === "system" ? (dark ? "dark" : "light") : value;
}
// Static, nonce-bearing prepaint script. No user-provided text is interpolated.
export const TRACKER_THEME_INIT = `try {
  var tt = localStorage.getItem("${TRACKER_THEME_KEY}") ?? localStorage.getItem("imds-theme");
  document.documentElement.dataset.trackerPreference = tt === "light" || tt === "dark" ? tt : "system";
} catch {
  document.documentElement.dataset.trackerPreference = "system";
}
document.documentElement.dataset.trackerTheme = document.documentElement.dataset.trackerPreference === "system"
  ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
  : document.documentElement.dataset.trackerPreference;`;
