"use client";
import { useEffect, useState } from "react";
import { TRACKER_THEME_KEY, normalizeTrackerTheme, resolveTrackerTheme, type TrackerTheme } from "@/lib/tracker/theme";
export const trackerViews = [
  {id:"overview",label:"Overview"},{id:"models",label:"Model Tracker"},{id:"suppliers",label:"Suppliers"},
  {id:"followup",label:"Follow-up"},{id:"check",label:"Check"},{id:"directory",label:"Directory"},
  {id:"reports",label:"Reports"},{id:"history",label:"History"},{id:"settings",label:"Settings"}
] as const;
export type TrackerView = (typeof trackerViews)[number]["id"];

export function isTrackerMigrationPath(path: string) {
  return path === "/tracker-migration" || path === "/tracker-migration/fixture";
}

export function trackerViewFromHash(hash: string): TrackerView {
  return trackerViews.find(view => "#" + view.id === hash.split("?")[0])?.id ?? "overview";
}
export function useTrackerTheme(enabled: boolean) {
  const [preference, setMode] = useState<TrackerTheme>("system");
  useEffect(() => {
    if (!enabled) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const { dataset } = document.documentElement;
    const sync = () => {
      let value = normalizeTrackerTheme(dataset.trackerPreference ?? null);
      try {
        value = normalizeTrackerTheme(localStorage.getItem(TRACKER_THEME_KEY), localStorage.getItem("imds-theme"));
      } catch {
        // The current document still supports theme switching when storage is blocked.
      }
      setMode(value);
      dataset.trackerPreference = value;
      dataset.trackerTheme = resolveTrackerTheme(value, media.matches);
    };
    const onMedia = () => {
      if (dataset.trackerPreference === "system") dataset.trackerTheme = resolveTrackerTheme("system", media.matches);
    };
    sync();
    media.addEventListener("change", onMedia);
    window.addEventListener("storage", sync);
    return () => {
      media.removeEventListener("change", onMedia);
      window.removeEventListener("storage", sync);
    };
  }, [enabled]);

  function setPreference(value: TrackerTheme) {
    setMode(value);
    try { localStorage.setItem(TRACKER_THEME_KEY, value); } catch { /* Session-only preference. */ }
    document.documentElement.dataset.trackerPreference = value;
    document.documentElement.dataset.trackerTheme = resolveTrackerTheme(value, matchMedia("(prefers-color-scheme: dark)").matches);
  }

  return { preference, setPreference, toggle: () => setPreference(document.documentElement.dataset.trackerTheme === "dark" ? "light" : "dark") };
}
