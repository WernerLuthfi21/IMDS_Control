// Tracker preference never writes the Judgement imds-theme key.
export const TRACKER_THEME_KEY = "imds-tracker-theme";
export type TrackerTheme = "light" | "dark" | "system";
export function normalizeTrackerTheme(value: string | null): TrackerTheme {
  return value === "light" || value === "dark" ? value : "system";
}
export function resolveTrackerTheme(value: TrackerTheme, dark: boolean): "light" | "dark" {
  return value === "system" ? (dark ? "dark" : "light") : value;
}
// Static, nonce-bearing prepaint script. No user-provided text is interpolated.
export const TRACKER_THEME_INIT = 'try{var tt=localStorage.getItem("imds-tracker-theme");document.documentElement.dataset.trackerTheme=tt==="light"||tt==="dark"?tt:matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}catch(e){document.documentElement.dataset.trackerTheme=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}';
