"use client";

import { aggregateSuppliers, countParts, dateLabel, generalStatuses, modelHealth, partStatuses, percent, type TrackerModel } from "@/lib/tracker/shared-master";
import { formatCount, modelAccent, ModelChips, PartCounts, SubmissionBar } from "./tracker-progress";

type Props = {
  models: TrackerModel[];
  selected: string;
  select: (key: string) => void;
  supplierList: string;
  followUp: string;
  settings: string;
  supplierLink: (company: string) => string;
};

export function TrackerModels({ models, selected, select, supplierList, followUp, settings, supplierLink }: Props) {
  const visible = models.filter(model => model.visible);
  const model = visible.find(item => item.key === selected);
  const parts = model?.parts ?? visible.flatMap(item => item.parts);
  const counts = countParts(parts);
  const suppliers = aggregateSuppliers(parts, models)
    .sort((a, b) => b.open - a.open || b.counts.process - a.counts.process || a.company.localeCompare(b.company));
  const shown = suppliers.slice(0, model ? 60 : 12);
  const hidden = models.length - visible.length;
  const health = model && modelHealth(model);

  return <>
    <header className="trk-view-heading">
      <h1>Model Tracker</h1>
      <p>{formatCount(visible.length)} {visible.length === 1 ? "model" : "models"} discovered from the workbook
        {hidden > 0 && <> · {hidden} hidden · <a className="trk-link" href={settings}>Manage in Settings</a></>}</p>
    </header>
    <div className="trk-model-tiles">
      {visible.map(item => {
        const health = modelHealth(item);
        return <button type="button" key={item.key} className="trk-model-card trk-model-tile" style={modelAccent(item)} aria-pressed={item.key === selected} onClick={() => select(item.key)}>
          <span className="trk-model-card-line"><span className="trk-model-name" translate="no"><i aria-hidden="true" />{item.label}</span><span className={`trk-health trk-${health.tone}`}>{health.label}</span></span>
          <span className="trk-tile-progress"><b className="trk-num">{item.progress}</b> <span className="trk-caption">% submitted</span></span>
          <SubmissionBar counts={item.counts} label={item.label} />
          <span className="trk-model-card-line"><PartCounts counts={item.counts} /><span className="trk-caption trk-num">{formatCount(item.counts.total)} parts</span></span>
          <span className="trk-model-card-line trk-model-tile-footer">
            <span>{!item.deadline ? "No deadline set" : item.done ? "Deadline met" : item.days < 0 ? `${Math.abs(item.days)} days overdue` : `${item.days} days left`}</span>
            {item.deadline && <span className="trk-caption trk-num">{dateLabel(item.deadline)}</span>}
          </span>
        </button>;
      })}
    </div>
    <section className="trk-panel trk-model-detail" style={model && modelAccent(model)} aria-label="Model details" aria-live="polite">
      <header className="trk-panel-heading">
        <div><h2 className="trk-model-detail-title">{model ? <span className="trk-model-name" translate="no"><i aria-hidden="true" />{model.label}</span> : "All models"}</h2>
          <p>{model ? model.deadline ? `Deadline ${dateLabel(model.deadline)} · ${model.done ? "met" : model.days < 0 ? `overdue by ${Math.abs(model.days)} days` : `${model.days} days left`}` : "No deadline set"
            : `${formatCount(visible.length)} models · ${formatCount(counts.total)} parts · select a model to focus the Tracker`}</p>
        </div>
        <div className="trk-row">{health && <span className={`trk-health trk-${health.tone}`}>{health.label}</span>}
          <a className="btn btn-primary" href={supplierList}>Open suppliers</a><a className="btn" href={followUp}>Follow-up</a>
          {model && <button type="button" className="btn" onClick={() => select("")}>Show all models</button>}
        </div>
      </header>
      <div className="trk-model-detail-body">
        <dl className="trk-detail-stats">
          <div className="trk-detail-percentage"><dt>Submitted</dt><dd className="trk-num">{percent(counts.complete, counts.total)}%</dd></div>
          {generalStatuses.map(status => <div key={status} className={`trk-${partStatuses[status].tone}`}><dt>{partStatuses[status].label}</dt><dd className="trk-num">{formatCount(counts[status])}</dd></div>)}
        </dl>
        <div className="trk-supplier-breakdown">
          <h3>{model ? "Suppliers in this model" : "Suppliers needing the most attention"} <span className="trk-caption trk-num">{suppliers.length}</span></h3>
          <div className="trk-table-scroll" tabIndex={0} role="region" aria-label="Supplier breakdown">
            <table className="trk-table">
              <thead><tr><th scope="col">Supplier</th><th scope="col">Parts</th><th scope="col">Done</th></tr></thead>
              <tbody>{shown.map(supplier => <tr key={supplier.company}>
                <th scope="row"><a className="trk-link" href={supplierLink(supplier.company)}>{supplier.company}</a>{!model && <ModelChips keys={supplier.models} models={models} />}</th>
                <td><SubmissionBar counts={supplier.counts} label={supplier.company} /><div className="trk-row"><b className="trk-num">{formatCount(supplier.counts.total)}</b><PartCounts counts={supplier.counts} /></div></td>
                <td className="trk-num"><b>{supplier.progress}%</b></td>
              </tr>)}</tbody>
            </table>
          </div>
          {suppliers.length > shown.length && <p className="trk-caption">Showing {shown.length} of {suppliers.length}. <a className="trk-link" href={supplierList}>Open all in Suppliers</a></p>}
        </div>
      </div>
    </section>
  </>;
}
