"use client";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Copy, Download, LoaderCircle, Search, ShieldCheck } from "lucide-react";
import { DETAIL_COLUMNS, type PartDetail } from "@/lib/judgement/gcats-detail";
import { toneOf } from "@/lib/judgement/stacks";

type Row = { id: string; delivery_part_no: string | null; supplier_code: string | null; judge: string | null; source_status: string | null };
type PartLine = { part: string; supplier: string; total: number; decided: number };

/**
 * G-CATS Detail per part number, laid out like TMC's G-CATS "Detail" screen, for TMA to check.
 * After TMA approves, a person types Check + Comment into G-CATS. The app never sends anything.
 */
export function GcatsDetailView({ rows, initialPart }: { rows: Row[]; initialPart?: string }) {
  const [q, setQ] = useState("");
  const [onlyReady, setOnlyReady] = useState(true);
  const [sel, setSel] = useState(initialPart || "");
  const [detail, setDetail] = useState<PartDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");

  const parts = useMemo<PartLine[]>(() => {
    const m = new Map<string, PartLine>();
    for (const r of rows) {
      if (!r.delivery_part_no) continue;
      const part = r.delivery_part_no.trim();
      const l = m.get(part.toUpperCase()) ?? { part, supplier: r.supplier_code || "", total: 0, decided: 0 };
      l.total++; if (r.judge === "OK" || r.judge === "NG") l.decided++;
      m.set(part.toUpperCase(), l);
    }
    return [...m.values()].sort((a, b) => Number(b.decided === b.total) - Number(a.decided === a.total) || a.part.localeCompare(b.part));
  }, [rows]);
  const ready = parts.filter((p) => p.decided === p.total);
  const term = q.trim().toUpperCase();
  const shown = parts.filter((p) => (!onlyReady || p.decided === p.total) && (!term || p.part.toUpperCase().includes(term) || p.supplier.toUpperCase().includes(term)));

  useEffect(() => { if (initialPart) setSel(initialPart); }, [initialPart]);
  useEffect(() => {
    if (!sel) { setDetail(null); return; }
    let live = true;
    setBusy(true); setError("");
    fetch("/api/judgement/detail?parts=" + encodeURIComponent(sel))
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || "Could not load the detail."); return j; })
      .then((j) => { if (live) setDetail((j.details as PartDetail[])[0] ?? null); if (live && !(j.details as PartDetail[]).length) setError("This part is not in the latest G-CATS snapshot."); })
      .catch((e) => { if (live) { setDetail(null); setError(e instanceof Error ? e.message : "Could not load the detail."); } })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [sel]);

  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(""), 1600); }
    catch { setError("The browser blocked copying. Select the text and copy it by hand."); }
  };
  const exportHref = (list: string[]) => "/api/judgement/detail?format=xlsx&parts=" + encodeURIComponent(list.join(","));

  return <div className="gd">
    <nav className="gd-list" aria-label="Part numbers">
      <label className="fl-search"><Search size={14}/><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Part no. or supplier…" aria-label="Find a part"/></label>
      <div className="gd-filter" role="group" aria-label="Which parts">
        <button type="button" className={onlyReady ? "on" : ""} aria-pressed={onlyReady} onClick={() => setOnlyReady(true)}>Ready for TMA ({ready.length})</button>
        <button type="button" className={!onlyReady ? "on" : ""} aria-pressed={!onlyReady} onClick={() => setOnlyReady(false)}>All parts ({parts.length})</button>
      </div>
      {ready.length > 0 && <a className="gd-export-all" href={exportHref(ready.slice(0, 200).map((p) => p.part))} download><Download size={14}/> Excel for TMA: {Math.min(ready.length, 200)} ready part{ready.length === 1 ? "" : "s"}</a>}
      <div className="fl-scroll">
        {shown.slice(0, 300).map((p) => <button type="button" key={p.part} className={"gd-item" + (p.part === sel ? " on" : "")} aria-current={p.part === sel} onClick={() => setSel(p.part)}>
          <span className="mono">{p.part}</span><small>{p.supplier || "—"}</small>
          <em className={p.decided === p.total ? "done" : ""}>{p.decided}/{p.total}</em>
        </button>)}
        {!shown.length && <p className="fl-none">{onlyReady ? "No part has every error judged yet." : "No part matches."}</p>}
      </div>
    </nav>

    <section className="gd-screen" aria-label={detail ? "G-CATS Detail " + detail.header.deliveryPartNo : "G-CATS Detail"}>
      <header className="gd-bar"><strong>G-CATS · Detail</strong><span><ShieldCheck size={14}/> Prepared by the app for TMA check · typed into G-CATS by a person</span></header>
      {!sel && <p className="gd-empty">Pick a part number. Parts where every error has a judgement are ready for TMA.</p>}
      {busy && <p className="gd-empty"><LoaderCircle size={15} className="spin"/> Loading the detail…</p>}
      {error && !busy && <div className="jx-error" role="alert"><AlertTriangle size={14}/> {error}</div>}
      {detail && !busy && <>
        <div className="gd-top">
          <h2>Detail</h2>
          <div className="gd-actions">
            <a className="gd-btn" href={exportHref([detail.header.deliveryPartNo])} download><Download size={14}/> Excel</a>
            <button type="button" className="gd-btn" onClick={() => void copy(detail.rows.map((r) => [r.check, r.errorType, r.comment].join("\t")).join("\n"), "rows")}><Copy size={14}/> {copied === "rows" ? "Copied" : "Copy Check + Comment"}</button>
          </div>
        </div>
        <table className="gd-head-table"><thead><tr><th>Area Code</th><th>Supplier Code</th><th>Delivery Part No.</th><th>Bus. Ent.</th><th>Company Name</th></tr></thead>
          <tbody><tr><td>{detail.header.areaCode || "—"}</td><td>{detail.header.supplierCode}</td><td className="mono">{detail.header.deliveryPartNo}</td><td>{detail.header.busEnt || "—"}</td><td>{detail.header.companyName || "—"}</td></tr></tbody></table>
        <p className="gd-sub">Error Details <span>{detail.decided} of {detail.total} judged</span></p>
        <div className="gd-grid" role="region" aria-label="Error details" tabIndex={0}>
          <table>
            <thead><tr><th>#</th>{DETAIL_COLUMNS.map(([k, l]) => <th key={k}>{l}</th>)}</tr></thead>
            <tbody>{detail.rows.map((r, i) => <tr key={r.id}>
              <td>{i + 1}</td>
              {DETAIL_COLUMNS.map(([k]) => k === "check" ? <td key={k} className={"gd-check " + (r.check ? r.check.toLowerCase() : "none")}>{r.check || "—"}</td>
                : k === "errorType" ? <td key={k} className={"gd-type t-" + toneOf(r.errorType)}>{r.errorType}</td>
                : <td key={k} className={k === "comment" || k === "commentLastTime" ? "gd-comment" : ""}>{r[k] || ""}</td>)}
            </tr>)}</tbody>
          </table>
        </div>
        <p className="gd-sub">SMS Parts/Mass Information (12-digits matching)</p>
        <table className="gd-head-table gd-sms"><thead><tr><th>Drawing Mass Max</th><th>Min</th><th>Actual Mass Max</th><th>Min</th><th>Drawing</th><th>Drawing(2D)</th><th>Drawing(3D)</th><th>Drawing Status</th></tr></thead>
          <tbody><tr><td>{detail.sms.drawingMax || "—"}</td><td>{detail.sms.drawingMin || "—"}</td><td>{detail.sms.actualMax || "—"}</td><td>{detail.sms.actualMin || "—"}</td><td>{detail.sms.drawing || "—"}</td><td>{detail.sms.drawing2d || "—"}</td><td>{detail.sms.drawing3d || "—"}</td><td>{detail.sms.drawingStatus || "—"}</td></tr></tbody></table>
        <p className="gd-sub">Record of changing to &quot;OK/NG&quot; <span>If G-CATS sends REJECT, this comment goes to the top of &quot;Reason for refusal&quot; in IMDS.</span></p>
        <div className="gd-record">
          {[...new Set(detail.rows.filter((r) => r.comment).map((r) => r.comment))].map((c) => <button type="button" key={c} onClick={() => void copy(c, c)} title="Copy this comment">{c} <em>{copied === c ? "copied" : "copy"}</em></button>)}
          {!detail.rows.some((r) => r.comment) && <span className="gd-empty">No comment yet — judge the errors first.</span>}
        </div>
      </>}
    </section>
  </div>;
}
