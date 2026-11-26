"use client";

import { useEffect, useState } from "react";
import { countParts, type ModelPreferences, type TrackerCounts, type TrackerModel } from "@/lib/tracker/shared-master";

const modelKey = "imds-model-meta";
const recapKey = "imds-weekly-snapshots";

export type TrackerRecap = {
  id: string;
  ts: string;
  dateKey: string;
  manual: boolean;
  overall: TrackerCounts;
  projects: Record<string, TrackerCounts>;
};

function load(key: string): unknown {
  try { return JSON.parse(localStorage.getItem(key) ?? "null"); } catch { return null; }
}

function loadRecaps(key: string): TrackerRecap[] {
  const stored = load(key);
  return Array.isArray(stored) ? stored.filter(item => item && typeof item.ts === "string") : [];
}

export function useTrackerStorage(fixture: boolean) {
  const key = fixture ? recapKey + "-fixture" : recapKey;
  const [preferences, setPreferences] = useState<ModelPreferences>({});
  const [recaps, setRecaps] = useState<TrackerRecap[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  useEffect(() => {
    function sync() {
      const models = load(modelKey);
      setPreferences(models && typeof models === "object" && !Array.isArray(models) ? models as ModelPreferences : {});
      setRecaps(loadRecaps(key));
      setStorageReady(true);
    }
    sync();
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [key]);

  function saveRecap(models: TrackerModel[], manual: boolean) {
    const recaps = loadRecaps(key);
    const now = new Date();
    const ts = now.toISOString();
    const dateKey = ts.slice(0, 10);
    if (!manual && recaps.some(recap => !recap.manual && recap.dateKey === dateKey)) return true;
    const visible = models.filter(model => model.visible);
    const recap = {
      id: (manual ? "manual-" : "auto-") + now.getTime(),
      ts, dateKey, manual,
      overall: countParts(visible.flatMap(model => model.parts)),
      projects: Object.fromEntries(visible.map(model => [model.key, model.counts]))
    };
    const next = [...recaps, recap].slice(-120);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { return false; }
    setRecaps(next);
    return true;
  }

  return { preferences, recaps, storageReady, saveRecap };
}
