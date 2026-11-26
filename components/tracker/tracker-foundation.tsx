"use client";

import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { SettingsTabs } from "@/components/settings-tabs";
import { confirmAction } from "@/components/ui/confirm-dialog";
import {
  buildModelRegistry, buildTrackerDataset, emptyScope, partStatuses, scopeParts,
  type GeneralStatus, type TrackerScope
} from "@/lib/tracker/shared-master";
import { trackerViews, trackerViewFromHash, type TrackerView } from "./foundation-state";
import { TrackerModels } from "./tracker-models";
import { TrackerOverview } from "./tracker-overview";
import { useTrackerStorage } from "./tracker-storage";
import { useSharedMaster, type MasterSnapshot } from "./use-shared-master";
import type { TrackerDueDates } from "@/lib/tracker/shared-master";
import "./tracker-workspace.css";

type Props = { fixture?: { snapshot: MasterSnapshot; dueDates: TrackerDueDates } };

function legacyLink(view: TrackerView, scope: TrackerScope, extra: Record<string, string> = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...scope, ...extra })) if (value) params.set(key, value);
  if (params.size) params.set("from", "tracker-migration");
  return "/imds-tracker" + (params.size ? "?" + params.toString() : "") + "#" + view;
}

function FixtureControls() {
  const [note, setNote] = useState("");
  return <section className="trk-panel">
    <h2>Theme and interaction fixture</h2>
    <SettingsTabs compact syncHash={false} label="Fixture sections" tabs={[
      { id: "source", label: "Data source", hint: "Synthetic only", content: <div className="trk-row">
        <button type="button" className="btn" onClick={async () => setNote(await confirmAction({ title: "Fixture confirmation", body: "No operation is performed.", confirmLabel: "Confirm" }) ? "Confirmed fixture" : "Cancelled fixture")}>Open confirmation</button>
        <button type="button" className="btn" disabled>Unavailable action</button><span role="status">{note}</span>
      </div> },
      { id: "models", label: "Models & display", hint: "Local controls", content: <label>Model name<input defaultValue="FIXTURE-MODEL" /></label> },
      { id: "templates", label: "Templates", hint: "Local draft", content: <>
        <label>Channel<select defaultValue="Email"><option>Email</option><option>WhatsApp</option></select></label>
        <label>Message preview<textarea defaultValue="Synthetic draft. No recipient." /></label>
      </> }
    ]} />
  </section>;
}

export function TrackerFoundation({ fixture }: Props) {
  const [view, setView] = useState<TrackerView>("overview");
  const [scope, setScope] = useState<TrackerScope>(emptyScope);
  const [notice, setNotice] = useState("");
  const [readyToReadHash, setReadyToReadHash] = useState(false);
  const master = useSharedMaster(fixture);
  const storage = useTrackerStorage(Boolean(fixture));
  const dataset = useMemo(() => buildTrackerDataset(master.snapshot?.rows ?? []), [master.snapshot]);
  const models = useMemo(() => buildModelRegistry(dataset.active, storage.preferences, master.dueDates), [dataset.active, storage.preferences, master.dueDates]);
  const selectedModel = models.find(model => model.key === scope.model && model.visible);
  const activeScope = selectedModel || !models.length ? scope : { ...scope, model: "" };
  const current = trackerViews.find(item => item.id === view)!;

  useEffect(() => {
    const read = () => {
      // The skip target and nested controls do not select a primary view.
      if (location.hash === "#main-content") return;
      const next = trackerViewFromHash(location.hash);
      setView(next);
      document.title = trackerViews.find(item => item.id === next)!.label + " · IMDS Tracker";
    };
    read();
    setReadyToReadHash(true);
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  useEffect(() => {
    const requested = new URLSearchParams(location.search).get("supplier")?.trim();
    // Existing supplier deep links belong to the supplier drawer until its
    // React counterpart is available.
    if (requested && !location.hash) location.hash = "suppliers";
  }, []);

  const saveAutoRecap = useEffectEvent(() => {
    if (dataset.active.length && storage.storageReady && master.state === "ready") storage.saveRecap(models, false);
  });
  useEffect(() => {
    saveAutoRecap();
  }, [dataset, master.state, storage.storageReady]);

  function saveRecap() {
    setNotice(storage.saveRecap(models, true) ? "Recap saved · " + new Date().toLocaleString() : "The recap could not be saved — browser storage is unavailable or full.");
  }

  function selectModel(model: string, openView: boolean) {
    setScope(current => openView ? { ...current, model, status: "" } : { ...current, model });
    if (openView) location.hash = "models";
  }

  function existing(target: TrackerView, extra?: Record<string, string>) {
    return fixture ? "#" + target : legacyLink(target, activeScope, extra);
  }
  const supplierLink = (name: string) => existing("suppliers", { supplier: name, action: "supplier" });
  const liveView = view === "overview" || view === "models";
  const isUnavailable = !master.snapshot || master.state === "restricted";
  const hasParts = dataset.active.length > 0;

  return <section className="trk-foundation trk-workspace" aria-label="Tracker migration foundation">
    {fixture && <p className="trk-caption">SYNTHETIC FIXTURE</p>}
    {readyToReadHash && !liveView && <header className="trk-view-heading"><h1>{current.label}</h1></header>}
    {readyToReadHash && liveView && !fixture && <div className="trk-source-state">
      <span role="status">{master.state === "loading" ? "Checking shared master…" : master.state === "ready" ? "Shared master live" : master.message}{master.state === "error" && master.snapshot && " Last loaded data is shown."}</span>
      {master.state !== "restricted" && <button type="button" className="btn" disabled={master.state === "loading"} onClick={master.refresh}>Refresh</button>}
    </div>}
    {readyToReadHash && liveView && master.dueWarning && !isUnavailable && <p className="trk-caption" role="status">{master.dueWarning}</p>}
    {readyToReadHash && liveView && !isUnavailable && hasParts && selectedModel && <div className="trk-row trk-scope" aria-label="Active filters">
      <span>Model</span><b translate="no">{selectedModel.label}</b><button type="button" className="trk-link" onClick={() => selectModel("", false)}>Clear model filter</button>
    </div>}
    {readyToReadHash && liveView && !isUnavailable && hasParts && view === "overview" && <TrackerOverview
      models={models} base={scopeParts(dataset.active, models, activeScope)} selectedModel={activeScope.model} status={scope.status}
      refreshedAt={master.snapshot!.refreshedAt} checkCount={dataset.checks.length + dataset.stopped.length} recaps={storage.recaps} fixture={Boolean(fixture)}
      selectModel={model => selectModel(model, true)}
      supplierList={(status: GeneralStatus) => existing("suppliers", { status })}
      supplierLink={supplierLink} reminderLink={name => existing("followup", { supplier: name, action: "reminder" })}
      saveRecap={saveRecap} settings={existing("settings")} followUp={existing("followup")}
      recapEmail={existing("followup", { action: "recap-email" })} reports={existing("reports", { action: "executive-report" })}
      check={existing("check")}
    />}
    {readyToReadHash && liveView && !isUnavailable && hasParts && view === "models" && <TrackerModels
      models={models} selected={activeScope.model} select={model => selectModel(model, false)}
      supplierList={existing("suppliers")} followUp={existing("followup")} settings={existing("settings")} supplierLink={supplierLink}
    />}
    {readyToReadHash && liveView && (isUnavailable || !hasParts) && <section className="trk-panel">
      <h1>{view === "overview" ? "IMDS Tracker" : current.label}</h1>
      {!isUnavailable && <><h2>No part list yet</h2><p>Upload the IMDS Remaining master in Settings.</p>
        {!fixture && <div><a className="btn btn-primary" href={existing("settings")}>Upload master</a></div>}</>}
    </section>}
    {readyToReadHash && !liveView && (fixture
      ? view === "settings" && <FixtureControls />
      : <section className="trk-panel"><p>This view is available in the existing Tracker.</p>
        <div><a className="btn btn-primary" href={legacyLink(view, activeScope, view === "suppliers" ? { supplier: new URLSearchParams(location.search).get("supplier") ?? "" } : undefined)}>Open {current.label}</a></div></section>)}
    {notice && <p className="trk-recap-notice" role="status">{notice}</p>}
    {!fixture && readyToReadHash && liveView && <p><a className="trk-link" href={existing(view)}>Open existing {current.label}</a></p>}
  </section>;
}
