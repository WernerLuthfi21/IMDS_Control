"use client";
import { useEffect, useState } from "react";
import { TRACKER_THEME_KEY, normalizeTrackerTheme, resolveTrackerTheme, type TrackerTheme } from "@/lib/tracker/theme";
export const trackerViews = [
  {id:"overview",label:"Overview"},{id:"models",label:"Model Tracker"},{id:"suppliers",label:"Suppliers"},
  {id:"followup",label:"Follow-up"},{id:"check",label:"Check"},{id:"directory",label:"Directory"},
  {id:"reports",label:"Reports"},{id:"history",label:"History"},{id:"settings",label:"Settings"}
] as const;
export function isTrackerMigrationPath(path: string) { return path==="/tracker-migration" || path==="/tracker-migration/fixture"; }
export function trackerViewFromHash(hash: string): string {
  const id=hash.replace(/^#/,""); return trackerViews.some(v=>v.id===id)?id:"overview";
}
export function useTrackerTheme(enabled: boolean) {
  const [preference,setMode]=useState<TrackerTheme>("system");
  useEffect(()=>{
    if(!enabled)return;
    const media=window.matchMedia("(prefers-color-scheme: dark)");
    const read=()=>{let mode:TrackerTheme="system";try{mode=normalizeTrackerTheme(localStorage.getItem(TRACKER_THEME_KEY));}catch{}setMode(mode);document.documentElement.dataset.trackerTheme=resolveTrackerTheme(mode,media.matches);};
    const onMedia=()=>{if(document.documentElement.dataset.trackerPreference==="system")document.documentElement.dataset.trackerTheme=media.matches?"dark":"light";};
    read();
    // Read preference from storage on cross-tab changes; current tab updates synchronously below.
    const sync=()=>{read();let value:TrackerTheme="system";try{value=normalizeTrackerTheme(localStorage.getItem(TRACKER_THEME_KEY));}catch{}document.documentElement.dataset.trackerPreference=value;};
    sync(); media.addEventListener("change",onMedia);window.addEventListener("storage",sync);
    return()=>{media.removeEventListener("change",onMedia);window.removeEventListener("storage",sync);};
  },[enabled]);
  function setPreference(value:TrackerTheme){setMode(value);try{localStorage.setItem(TRACKER_THEME_KEY,value);}catch{}document.documentElement.dataset.trackerPreference=value;document.documentElement.dataset.trackerTheme=resolveTrackerTheme(value,matchMedia("(prefers-color-scheme: dark)").matches);}
  return {preference,setPreference,toggle:()=>setPreference(document.documentElement.dataset.trackerTheme==="dark"?"light":"dark")};
}
