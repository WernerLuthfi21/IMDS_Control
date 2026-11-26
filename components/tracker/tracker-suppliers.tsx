"use client";

import { useEffect, useRef, useState } from "react";
import {
  aggregateSuppliers,
  countParts,
  dateLabel,
  generalStatuses,
  partStatuses,
  scopeParts,
  type TrackerModel,
  type TrackerPart,
  type TrackerScope,
  type TrackerSupplier,
} from "@/lib/tracker/shared-master";
import type { MasterContact } from "./use-shared-master";
import { ModelChips, PartCounts, SubmissionBar } from "./tracker-progress";

type Props = {
  parts: TrackerPart[];
  models: TrackerModel[];
  contacts: MasterContact[];
  scope: TrackerScope;
  changeScope: (scope: TrackerScope) => void;
  details: (company: string) => string;
  reminder: (company: string) => string;
};

const sorts = {
  supplier: "Supplier A–Z",
  descending: "Supplier Z–A",
  missing: "Outstanding ↓",
  progress: "Progress ↑",
  highest: "Progress ↓",
  deadline: "Deadline soonest",
  status: "Action first",
};
type Sort = keyof typeof sorts;

function orderSuppliers(
  items: TrackerSupplier[],
  sort: Sort,
  models: TrackerModel[],
) {
  const deadlines = new Map(
    models.map((m) => [m.key, m.deadline?.getTime() ?? Infinity]),
  );
  const due = (s: TrackerSupplier) =>
    Math.min(...s.models.map((k) => deadlines.get(k) ?? Infinity));
  return items.sort((a, b) => {
    const byName = a.company.localeCompare(b.company, "en", {
      sensitivity: "base",
    });
    switch (sort) {
      case "descending":
        return -byName;
      case "missing":
        return b.open - a.open || b.counts.process - a.counts.process || byName;
      case "highest":
        return b.progress - a.progress || b.open - a.open || byName;
      case "progress":
        return a.progress - b.progress || b.open - a.open || byName;
      case "deadline":
        return due(a) - due(b) || byName;
      case "status":
        return (
          Number(!!b.open) - Number(!!a.open) ||
          Number(!!b.counts.pastDue) - Number(!!a.counts.pastDue) ||
          b.open - a.open ||
          byName
        );
      default:
        return byName;
    }
  });
}

export function TrackerSuppliers({
  parts,
  models,
  contacts,
  scope,
  changeScope,
  details,
  reminder,
}: Props) {
  const [sort, setSort] = useState<Sort>("supplier");
  const [selected, setSelected] = useState("");
  useEffect(() => {
    const hashParams = new URLSearchParams(location.hash.split("?")[1]);
    const requested =
      hashParams.get("action") === "supplier"
        ? hashParams.get("supplier")
        : new URLSearchParams(location.search).get("supplier");
    const match =
      requested &&
      parts.find((p) =>
        [p.company, p.vendorCode].some(
          (v) => v.toUpperCase() === requested.toUpperCase(),
        ),
      );
    if (match) setSelected(match.company);
  }, [parts]);
  const [partFilter, setPartFilter] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const base = scopeParts(parts, models, scope);
  const counts = countParts(base);
  const all = aggregateSuppliers(base, models);
  const rows = orderSuppliers(
    all.filter((s) => !scope.status || s.counts[scope.status]),
    sort,
    models,
  );
  const supplier = all.find((s) => s.company === selected);
  const available = [...new Set(parts.map((p) => p.company))].sort();
  const change = (patch: Partial<TrackerScope>) =>
    changeScope({ ...scope, ...patch });
  useEffect(() => {
    if (supplier && !dialog.current?.open) dialog.current?.showModal();
    if (!supplier && dialog.current?.open) dialog.current.close();
  }, [supplier]);
  return (
    <>
      <header className="trk-view-heading">
        <h1>Suppliers</h1>
        <p>
          {all.length} suppliers · {base.length} parts
        </p>
      </header>
      <section className="trk-panel">
        <label>
          Search parts or suppliers
          <input
            type="search"
            value={scope.query}
            onChange={(e) => change({ query: e.target.value })}
          />
        </label>
        <details>
          <summary>Filters</summary>
          <div className="trk-row">
            <label>
              Model
              <select
                value={scope.model}
                onChange={(e) => change({ model: e.target.value })}
              >
                <option value="">All models</option>
                {models
                  .filter((m) => m.visible)
                  .map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.label}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Supplier
              <select
                value={scope.supplier}
                onChange={(e) => change({ supplier: e.target.value })}
              >
                <option value="">All suppliers</option>
                {available.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
            <label>
              Urgency
              <select
                value={scope.urgency}
                onChange={(e) => change({ urgency: e.target.value })}
              >
                <option value="">All</option>
                <option value="pastdue">Past due</option>
                <option value="due14">Due in 14 days</option>
                <option value="ontime">On time</option>
              </select>
            </label>
          </div>
        </details>
        <div
          className="trk-row"
          role="group"
          aria-label="Filter by submission status"
        >
          <button
            className="btn"
            aria-pressed={!scope.status}
            onClick={() => change({ status: "" })}
          >
            All {base.length}
          </button>
          {generalStatuses
            .filter((k) => k !== "rejected" || counts[k] || k === scope.status)
            .map((k) => (
              <button
                className="btn"
                key={k}
                aria-pressed={scope.status === k}
                onClick={() => change({ status: k })}
              >
                {partStatuses[k].label} {counts[k]}
              </button>
            ))}
          <label>
            Sort
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
            >
              {Object.entries(sorts).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="trk-table-wrap">
          <table className="trk-table">
            <caption className="sr-only">Supplier progress</caption>
            <thead>
              <tr>
                {[
                  "Supplier",
                  "Parts",
                  "Status",
                  "Progress",
                  "Contact",
                  "Actions",
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const contact = contacts.find(
                  (c) => c.company.toUpperCase() === s.company.toUpperCase(),
                );
                const email =
                  contact && (contact.pic || contact.cc || contact.spv);
                return (
                  <tr key={s.company}>
                    <th scope="row">
                      <button
                        className="trk-link"
                        aria-haspopup="dialog"
                        onClick={() => {
                          setPartFilter("");
                          setSelected(s.company);
                        }}
                      >
                        {s.company}
                      </button>
                      <ModelChips keys={s.models} models={models} />
                    </th>
                    <td>
                      <SubmissionBar counts={s.counts} label={s.company} />
                      {s.counts.total} parts <PartCounts counts={s.counts} />
                    </td>
                    <td>
                      {s.counts.complete === s.counts.total
                        ? "Submitted"
                        : s.counts.rejected === s.counts.total
                          ? "Rejected"
                          : s.open === s.counts.total
                            ? "Not Submitted Yet"
                            : "Working"}
                      {s.counts.pastDue > 0 && " · Past due"}
                    </td>
                    <td>{s.progress}%</td>
                    <td>
                      {email || (contact ? "No email" : "Not in contact list")}
                    </td>
                    <td>
                      {s.open > 0 && (
                        <a className="trk-link" href={reminder(s.company)}>
                          Remind
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!rows.length && <p role="status">No suppliers match</p>}
      </section>
      <dialog
        ref={dialog}
        className="trk-supplier-dialog"
        aria-labelledby="trk-supplier-title"
        onClose={() => setSelected("")}
      >
        {supplier && (
          <>
            <div className="trk-row">
              <h2 id="trk-supplier-title">{supplier.company}</h2>
              <button className="btn" onClick={() => dialog.current?.close()}>
                Close
              </button>
            </div>
            <ModelChips keys={supplier.models} models={models} />
            <SubmissionBar counts={supplier.counts} label={supplier.company} />
            <label>
              Part status
              <select
                value={partFilter}
                onChange={(e) => setPartFilter(e.target.value)}
              >
                <option value="">All</option>
                {generalStatuses.map((k) => (
                  <option key={k} value={k}>
                    {partStatuses[k].label}
                  </option>
                ))}
              </select>
            </label>
            <div className="trk-table-wrap">
              <table className="trk-table">
                <thead>
                  <tr>
                    {[
                      "Part number",
                      "Part name",
                      "Model",
                      "Status",
                      "Target date",
                    ].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {supplier.parts
                    .filter((p) => !partFilter || p.status === partFilter)
                    .map((p, i) => (
                      <tr key={p.masterId || i}>
                        <th>{p.partNo || "—"}</th>
                        <td>{p.partName}</td>
                        <td>{models.find((m) => m.key === p.model)?.label}</td>
                        <td>{partStatuses[p.status].label}</td>
                        <td>{p.targetDate ? dateLabel(p.targetDate) : "—"}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <a className="btn" href={details(supplier.company)}>
              Open supplier actions and PDF
            </a>
          </>
        )}
      </dialog>
    </>
  );
}
