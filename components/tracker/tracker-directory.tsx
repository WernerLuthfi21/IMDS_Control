"use client";

import { useEffect, useState } from "react";
import { findEntry, STRATA, type Directory } from "@/lib/followup/directory";
import {
  downloadDirectory,
  type TrackerDirectoryData,
} from "@/lib/tracker/directory-export";
import type { TrackerPart } from "@/lib/tracker/shared-master";

const sample: Directory = {
  entries: {
    "FIXTURE SEALS": {
      name: "Fixture Seals",
      code: "FIXTURE-SEALS",
      f: { buyer: "Fixture buyer", pic1_email: "fixture@example.invalid" },
    },
  },
  buyers: {
    "Fixture buyer": {
      full: "Synthetic Buyer",
      email: "buyer@example.invalid",
    },
  },
};

export function TrackerDirectory({
  fixture,
  parts,
  manage,
}: {
  fixture: boolean;
  parts: TrackerPart[];
  manage: string;
}) {
  const [directory, setDirectory] = useState<TrackerDirectoryData | null>(
    fixture ? sample : null,
  );
  const [error, setError] = useState("");
  const [tab, setTab] = useState("Suppliers");
  const [query, setQuery] = useState("");
  const [only, setOnly] = useState(true);
  const [selection, setSelection] = useState("");
  useEffect(() => {
    if (fixture) return;
    const controller = new AbortController();
    async function read() {
      const response = await fetch("/api/imds-master/settings?key=directory", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Could not load the shared directory.");
      const { exists, value } = await response.json();
      const local: TrackerDirectoryData =
        JSON.parse(localStorage.getItem("imds-directory") || "{}") || {};
      const shared: TrackerDirectoryData = exists && value ? value : {};
      const includeLocal =
        !exists ||
        localStorage.getItem("imds-dir-dirty") === "1" ||
        !Number(localStorage.getItem("imds-dir-srv-version"));
      setDirectory(
        includeLocal
          ? {
              entries: { ...local.entries, ...shared.entries },
              buyers: { ...local.buyers, ...shared.buyers },
              aliases: { ...local.aliases, ...shared.aliases },
              meta: { ...local.meta, ...shared.meta },
            }
          : shared,
      );
    }
    read().catch(() => {
      if (!controller.signal.aborted)
        setError(
          "Could not load the directory. Open the existing Directory to check the source and sync status.",
        );
    });
    return () => controller.abort();
  }, [fixture]);
  const companies = new Map<string, string>();
  parts.forEach((p) => {
    if (!companies.has(p.company)) companies.set(p.company, p.vendorCode);
  });
  const matches = Array.from(companies, ([company, code]) => ({
    company,
    match: findEntry(directory ?? {}, company, code),
  }));
  const ids = new Set(matches.map((m) => m.match?.key));
  const entries = Object.entries(directory?.entries ?? {})
    .filter(
      ([key, e]) =>
        (!only || !companies.size || ids.has(key)) &&
        [e.name, e.code, e.f?.buyer]
          .join(" ")
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) => a[1].name.localeCompare(b[1].name));
  const entry = entries.find(([k]) => k === selection)?.[1] ?? entries[0]?.[1];
  async function download(format: "xlsx" | "json") {
    if (!directory) return;
    try {
      await downloadDirectory(directory, format);
      setError("");
    } catch {
      setError("The directory could not be downloaded.");
    }
  }
  return (
    <>
      <header className="trk-view-heading">
        <h1>Directory</h1>
        <p>
          {directory
            ? Object.keys(directory.entries ?? {}).length +
              " suppliers in the directory"
            : error || "Loading directory…"}
        </p>
      </header>
      {directory && (
        <section className="trk-panel">
          <div className="trk-row" role="group" aria-label="Directory sections">
            {["Suppliers", "PUD buyers", "Tracker match"].map((t) => (
              <button
                className="btn"
                aria-pressed={t === tab}
                key={t}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
          {tab === "Suppliers" && (
            <>
              <label>
                Search suppliers
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              {companies.size > 0 && (
                <label>
                  <input
                    type="checkbox"
                    checked={only}
                    onChange={(e) => setOnly(e.target.checked)}
                  />{" "}
                  In Tracker only
                </label>
              )}
              <div className="trk-directory-columns">
                <div>
                  {entries.map(([k, e]) => (
                    <button
                      className="btn"
                      key={k}
                      aria-pressed={entry === e}
                      onClick={() => setSelection(k)}
                    >
                      {e.name}
                    </button>
                  ))}
                </div>
                {entry ? (
                  <section>
                    <h2>{entry.name}</h2>
                    <p>
                      {[entry.code, entry.f?.buyer].filter(Boolean).join(" · ")}
                    </p>
                    {Object.entries(STRATA).map(([group, roles]) => (
                      <section key={group}>
                        <h3>
                          {{
                            pic: "IMDS PIC",
                            mid: "Middle management",
                            top: "Top management",
                            dir: "Director",
                          }[group] ?? group}
                        </h3>
                        {roles.map((role) => {
                          const fields = ["name", "position", "email", "phone"]
                            .map((f) => entry.f?.[role + "_" + f])
                            .filter(Boolean);
                          return (
                            fields.length > 0 && (
                              <p key={role}>{fields.join(" · ")}</p>
                            )
                          );
                        })}
                      </section>
                    ))}
                  </section>
                ) : (
                  <p>No suppliers match.</p>
                )}
              </div>
            </>
          )}
          {tab === "PUD buyers" && (
            <div className="trk-table-wrap">
              <table className="trk-table">
                <thead>
                  <tr>
                    {["Buyer", "Full name", "Email", "Phone", "Suppliers"].map(
                      (s) => (
                        <th key={s}>{s}</th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(directory.buyers ?? {})
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([k, b]) => (
                      <tr key={k}>
                        <th>{k}</th>
                        <td>{b.full}</td>
                        <td>{b.email}</td>
                        <td>{b.phone}</td>
                        <td>
                          {
                            Object.values(directory.entries ?? {}).filter(
                              (e) => e.f?.buyer === k,
                            ).length
                          }
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
          {tab === "Tracker match" && (
            <div className="trk-table-wrap">
              <table className="trk-table">
                <thead>
                  <tr>
                    <th>Tracker supplier</th>
                    <th>Match</th>
                    <th>Directory entry</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map(({ company, match }) => (
                    <tr key={company}>
                      <th>{company}</th>
                      <td>{match?.how ?? "Unmatched"}</td>
                      <td>{match && directory.entries?.[match.key]?.name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {Object.keys(directory?.entries ?? {}).length > 0 && (
        <div className="trk-row">
          <button className="btn" onClick={() => download("xlsx")}>
            Export Excel
          </button>
          <button className="btn" onClick={() => download("json")}>
            Download backup
          </button>
        </div>
      )}
      {directory && error && <p role="alert">{error}</p>}
      {!fixture && (
        <a className="btn" href={manage}>
          Edit contacts, import or export directory
        </a>
      )}
    </>
  );
}
