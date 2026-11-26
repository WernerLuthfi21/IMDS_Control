"use client";

import type { ReactNode } from "react";
import {
  aggregateSuppliers, countParts, dateLabel, isSupplierAction, modelHealth, nextModelDeadline, partStatuses,
  percent, type GeneralStatus, type TrackerModel, type TrackerPart
} from "@/lib/tracker/shared-master";
import { TrackerMascot } from "./tracker-mascot";
import { formatCount, modelAccent, ModelChips, SubmissionBar } from "./tracker-progress";
import type { TrackerRecap } from "./tracker-storage";

type Props = {
  models: TrackerModel[];
  base: TrackerPart[];
  selectedModel: string;
  status: GeneralStatus | "";
  refreshedAt: string;
  checkCount: number;
  recaps: TrackerRecap[];
  fixture: boolean;
  selectModel: (key: string) => void;
  supplierList: (status: GeneralStatus) => string;
  supplierLink: (name: string) => string;
  reminderLink: (name: string) => string;
  saveRecap: () => void;
  settings: string;
  followUp: string;
  recapEmail: string;
  reports: string;
  check: string;
};

const kpis = ["complete", "process", "missing", "rejected"] as const;

function ProgressTrend({ recaps, save }: { recaps: TrackerRecap[]; save: () => void }) {
  const points = recaps.filter(item => item.overall).toSorted((a, b) => Date.parse(a.ts) - Date.parse(b.ts)).slice(-14);
  if (points.length < 2) return <p className="trk-trend-empty">Trend appears after two saved recaps. <button type="button" className="trk-link" onClick={save}>Save today’s recap</button></p>;
  const values = points.map(({ overall }) => percent(overall.complete, overall.total));
  const coordinates = values.map((value, index) => [6 + 308 * index / (values.length - 1), 6 + 72 * (1 - value / 100)]);
  const line = coordinates.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const [x, y] = coordinates[coordinates.length - 1];
  return <div>
    <svg className="trk-trend" viewBox="0 0 320 84" role="img" aria-label={`Overall submission progress from ${values[0]}% to ${values.at(-1)}% over ${values.length} recaps`}>
      <path className="trk-trend-area" d={`${line} L${x} 78 L6 78 Z`} />
      <path className="trk-trend-line" d={line} />
      <circle cx={x} cy={y} r="4" />
    </svg>
    <p className="trk-caption trk-num">{values[0]}% → <b>{values.at(-1)}%</b> · {values.length} recaps</p>
  </div>;
}

function Panel({ title, subtitle, className, action, children }: { title: string; subtitle?: string; className?: string; action?: ReactNode; children: ReactNode }) {
  return <section className={`trk-panel trk-overview-panel ${className ?? ""}`}>
    <header className="trk-panel-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</header>
    {children}
  </section>;
}

export function TrackerOverview(props: Props) {
  const { models, base, selectedModel, status, recaps, refreshedAt, checkCount, selectModel, saveRecap } = props;
  const visible = models.filter(model => model.visible);
  const counts = countParts(base);
  const progress = percent(counts.complete, counts.total);
  const deadline = nextModelDeadline(models);
  const scopedSuppliers = status ? new Set(base.filter(part => part.status === status).map(part => part.company)) : null;
  const suppliers = aggregateSuppliers(scopedSuppliers ? base.filter(part => scopedSuppliers.has(part.company)) : base, models)
    .filter(supplier => supplier.open)
    .sort((a, b) => Number(Boolean(b.counts.pastDue)) - Number(Boolean(a.counts.pastDue)) || b.open - a.open || a.progress - b.progress);
  const modelCount = new Set(base.map(part => part.model)).size;
  const noDate = base.filter(part => isSupplierAction(part.status) && !part.targetDate).length;
  const unfinished = visible.filter(model => !model.done).sort((a, b) => a.progress - b.progress);
  const insights = [
    counts.missing ? <><b>{formatCount(counts.missing)}</b> parts across <b>{formatCount(suppliers.length)}</b> suppliers are not submitted yet.</> : null,
    noDate ? <><b>{formatCount(noDate)}</b> outstanding {noDate === 1 ? "part has" : "parts have"} no target date.</> : null,
    counts.pastDue ? <><b>{formatCount(counts.pastDue)}</b> {counts.pastDue === 1 ? "part is" : "parts are"} past the target date.</> : null,
    unfinished.length > 1 ? <><span translate="no">{unfinished[0].label}</span> is furthest behind at <b>{unfinished[0].progress}%</b>.</> : null
  ].filter(Boolean);
  const kpiCaption = {
    complete: <><b>{formatCount(counts.complete)}</b> of <b>{formatCount(counts.total)}</b> parts</>,
    process: "Under TMMIN judgement",
    missing: counts.pastDue ? <><b>{formatCount(counts.pastDue)}</b> past target date</> : "Supplier action required",
    rejected: counts.rejected ? "Supplier must resubmit" : "No rejected part"
  };

  return <>
    <header className="trk-hero">
      <div className="trk-hero-copy">
        <h1><span translate="no">IMDS</span> Tracker</h1>
        <p>{counts.total ? <><b className="trk-num">{progress}%</b> submitted across <b className="trk-num">{modelCount}</b> {modelCount === 1 ? "model" : "models"}.{" "}
          {suppliers.length ? <><b className="trk-num">{formatCount(suppliers.length)}</b> {suppliers.length === 1 ? "supplier still needs" : "suppliers still need"} a follow-up.</> : "No supplier follow-up is needed right now."}</>
          : "No parts match the current filters."}</p>
        <p className="trk-caption"><span className="trk-live-dot" aria-hidden="true" /> Last updated <time dateTime={refreshedAt}>{new Date(refreshedAt).toLocaleString("en-GB")}</time> · Shared IMDS Master</p>
      </div>
      <TrackerMascot />
    </header>
    <div className="trk-ledger" aria-label="Submission status">
      {kpis.map(key => {
        const meta = partStatuses[key];
        const value = key === "complete" ? progress : counts[key];
        return <a key={key} className={`trk-kpi trk-${meta.tone}`} href={props.supplierList(key)}>
          <span className="trk-kpi-title">{meta.label}</span>
          <strong className="trk-num">{formatCount(value)}{key === "complete" && <small>%</small>}</strong>
          <span className="trk-caption">{kpiCaption[key]}</span>
          <span className="trk-kpi-bar" aria-hidden="true"><span style={{ width: `${percent(counts[key], counts.total)}%` }} /></span>
        </a>;
      })}
      {deadline?.deadline ? <button className={`trk-kpi trk-${deadline.days < 0 ? "bad" : deadline.days <= 14 ? "warn" : "accent"}`} type="button" onClick={() => selectModel(deadline.key)}>
        <span className="trk-kpi-title">{deadline.days < 0 ? "Overdue deadline" : "Next deadline"}</span>
        <strong className="trk-num">{Math.abs(deadline.days)}<small>d</small></strong>
        <span className="trk-caption">{deadline.label} · {dateLabel(deadline.deadline)}</span>
        <span className="trk-caption">{deadline.counts.missing + deadline.counts.rejected} parts still open</span>
      </button> : <div className="trk-kpi trk-accent">
        <span className="trk-kpi-title">Next deadline</span><strong>—</strong>
        <span className="trk-caption">No open model has a deadline.</span><a className="trk-link" href={props.settings}>Set deadlines in Settings</a>
      </div>}
    </div>
    <div className="trk-overview-grid">
      <Panel title="Models" subtitle={`${visible.length} ${visible.length === 1 ? "model" : "models"}`}
        action={<a className="btn" href="#models">Open Model Tracker</a>}>
        <div className="trk-model-strip">
          {visible.map(model => {
            const health = modelHealth(model);
            return <button className="trk-model-card" type="button" style={modelAccent(model)} key={model.key} aria-pressed={model.key === selectedModel} onClick={() => selectModel(model.key)}>
              <span className="trk-model-card-line"><span className="trk-model-name" translate="no"><i aria-hidden="true" />{model.label}</span><b className="trk-num">{model.progress}%</b></span>
              <SubmissionBar counts={model.counts} label={model.label} />
              <span className="trk-model-card-line"><span className={`trk-health trk-${health.tone}`}>{health.label}</span><span className="trk-caption trk-num">{formatCount(model.counts.complete)}/{formatCount(model.counts.total)}</span></span>
              <span className="trk-caption">{model.deadline ? `Deadline ${dateLabel(model.deadline)}` : "No deadline set"}</span>
            </button>;
          })}
        </div>
      </Panel>
      <Panel title="Quick actions">
        <div className="trk-quick-actions">
          {!props.fixture && <>
            <a href={props.settings}>Import or refresh Excel</a>
            <a href={props.reports}>Executive summary PDF</a>
            <a href={props.recapEmail}>Status recap e-mail</a>
          </>}
          <button type="button" onClick={saveRecap}>Save today’s recap</button>
          {checkCount > 0 && <a href={props.check}>{formatCount(checkCount)} in Check</a>}
        </div>
      </Panel>
      <Panel title="Suppliers needing attention" subtitle="Overdue first, then most parts outstanding"
        action={suppliers.length > 5 && <a className="btn" href={props.followUp}>View all {suppliers.length} in Follow-up</a>}>
        {suppliers.length ? <ul className="trk-attention">
          {suppliers.slice(0, 5).map(supplier => {
            const tone = supplier.counts.pastDue ? "bad" : supplier.progress < 30 ? "warn" : "neutral";
            return <li key={supplier.company} className={`trk-attention-row trk-${tone}`}>
              <div>
                <div className="trk-row"><a className="trk-link" href={props.supplierLink(supplier.company)}>{supplier.company}</a>
                  <span className="trk-health">{supplier.counts.pastDue ? "Critical" : supplier.progress < 30 ? "High" : "Monitor"}</span>
                  {supplier.counts.pastDue > 0 && <span className="trk-health trk-bad">Past due</span>}
                </div>
                <div className="trk-row trk-caption"><span><b>{supplier.open}</b> of {supplier.counts.total} remaining</span><span>{supplier.progress}% done</span><ModelChips keys={supplier.models} models={models} /></div>
              </div>
              {!props.fixture && <a className="btn" href={props.reminderLink(supplier.company)}>Remind</a>}
            </li>;
          })}
        </ul> : <div className="trk-empty"><strong>No supplier action required</strong><p>{counts.process ? `${formatCount(counts.process)} part(s) are still under TMMIN judgement.` : "Every part in this view is submitted."}</p></div>}
      </Panel>
      <Panel title="Insights" subtitle="From saved recaps and the current scope">
        <ProgressTrend recaps={recaps} save={saveRecap} />
        {insights.length ? <ul className="trk-insights">{insights.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className="trk-caption">Nothing needs attention in this view.</p>}
      </Panel>
    </div>
  </>;
}
