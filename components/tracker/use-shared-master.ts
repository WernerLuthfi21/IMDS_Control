"use client";

import { useEffect, useState } from "react";
import type { MasterRow, TrackerDueDates } from "@/lib/tracker/shared-master";

export type MasterContact = { company: string; pic: string; cc: string; spv: string; note: string };
export type MasterSnapshot = { rows: MasterRow[]; contacts: MasterContact[]; refreshedAt: string };
const emptyDueDates: TrackerDueDates = { version: 0, models: {}, suppliers: {} };

type MasterState = {
  snapshot: MasterSnapshot | null;
  dueDates: TrackerDueDates;
  dueWarning: string;
  state: "loading" | "ready" | "error" | "restricted";
  message: string;
};

const loading: MasterState = { snapshot: null, dueDates: emptyDueDates, dueWarning: "", state: "loading", message: "" };
const requestOptions = { cache: "no-store", credentials: "same-origin" } as const;
const blocked = (status: number) => status === 401 || status === 403;

async function readDueDates(signal: AbortSignal) {
  const response = await fetch("/api/imds-master/settings?key=due_dates", { ...requestOptions, signal });
  if (blocked(response.status)) return { restricted: true as const };
  if (!response.ok) throw new Error("Shared deadlines could not be loaded.");
  const body: { value?: Omit<TrackerDueDates, "version">; version?: number; tableMissing?: boolean } = await response.json();
  return {
    dueDates: { ...emptyDueDates, ...body.value, version: body.version ?? 0 },
    dueWarning: body.tableMissing ? "Shared deadlines are unavailable. Browser and legacy defaults are shown." : ""
  };
}

export function useSharedMaster(fixture?: { snapshot: MasterSnapshot; dueDates: TrackerDueDates }) {
  const [current, setCurrent] = useState<MasterState>(() => fixture
    ? { ...loading, ...fixture, state: "ready" }
    : loading);
  const [refreshIndex, setRefreshIndex] = useState(0);
  useEffect(() => {
    if (fixture) return;
    const controller = new AbortController();
    let etag: string | null = null;
    let running = false;
    let lastDueDates = emptyDueDates;
    let lastDueWarning = "";
    function restrict() {
      etag = null;
      lastDueDates = emptyDueDates;
      lastDueWarning = "";
      setCurrent({ ...loading, state: "restricted", message: "Unable to access the shared master. Check your workspace session and permissions." });
    }
    async function refresh(manual = false) {
      if (running) return;
      running = true;
      try {
        if (manual) setCurrent(state => ({ ...state, state: "loading", message: "" }));
        const headers = new Headers({ Accept: "application/json" });
        if (etag) headers.set("If-None-Match", etag);
        const response = await fetch("/api/imds-master/tracker-data", { ...requestOptions, signal: controller.signal, headers });
        if (blocked(response.status)) {
          restrict();
          return;
        }

        let snapshot: MasterSnapshot | undefined;
        if (response.status !== 304) {
          if (!response.ok) throw new Error("Could not refresh the shared master.");
          snapshot = await response.json() as MasterSnapshot;
          if (!Array.isArray(snapshot.rows) || !Array.isArray(snapshot.contacts)) throw new Error("The shared master response is invalid.");
          etag = response.headers.get("ETag");
        }

        try {
          const dates = await readDueDates(controller.signal);
          if (dates.restricted) {
            restrict();
            return;
          }
          lastDueDates = dates.dueDates;
          lastDueWarning = dates.dueWarning;
        } catch {
          lastDueWarning = "Shared deadlines could not be refreshed. Last available deadlines are shown.";
        }

        if (!controller.signal.aborted) {
          setCurrent(state => ({
            snapshot: snapshot ?? state.snapshot,
            state: "ready",
            message: "",
            dueDates: lastDueDates,
            dueWarning: lastDueWarning
          }));
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setCurrent(state => ({
            ...state,
            state: "error",
            message: error instanceof Error ? error.message : "Could not refresh the shared master."
          }));
        }
      } finally {
        running = false;
      }
    }

    function refreshVisible() {
      if (!document.hidden) void refresh();
    }
    void refresh(refreshIndex > 0);
    const timer = window.setInterval(refreshVisible, 15_000);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [fixture, refreshIndex]);

  return { ...current, refresh: () => setRefreshIndex(index => index + 1) };
}
