"use client";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Bot, LoaderCircle, Play, Power, Scale, Settings2, ShieldCheck } from "lucide-react";
import type { CatMood } from "@/components/cat-mascot";
import { CatStage } from "@/components/cat-stage";

type Kind = "mass" | "sms" | "app44" | "pb" | "elv" | "substance" | "warp";
type Config = { enabled: boolean; shadow: boolean; kinds: Record<Kind, boolean>; approvedBy: string | null; approvedAt: string | null; ruleSet?: string | null };
type Info = { config: Config; version: number; missing: boolean; migrationHint: string | null; canRun: boolean; canConfigure: boolean; systemActor: string; ruleSet?: string; ruleSetLabel?: string };
type RunResult = { id: string; kind: string; action: "FINAL" | "WOULD_FINAL" | "SKIP"; decision: "OK" | "NG" | null; reason: string };
type Compare = { id: string; kind: string; human: string; engine: string | null; agree: boolean | null };

const KIND_LABEL: Record<Kind, string> = {
  mass: "Mass tolerance (Type 7)",
  sms: "SMS mass (Type 6)",
  app44: "Application 44",
  pb: "ELV Pb",
  elv: "ELV Cd / Hg / Cr6+ (No.11–13)",
  substance: "Prohibited substances (No.14–19)",
  warp: "WARP part number (No.21)"
};
const CHUNK = 100;

export function AutoJudgeCard({ pendingIds, judgedIds, onFinal, openSettings = false }: {
  /** Open the rule-family settings on load (Settings → Judgement links here). */
  openSettings?: boolean;
  pendingIds: string[]; judgedIds: string[];
  onFinal: (items: Array<{ id: string; decision: "OK" | "NG" }>, actor: string) => void;
}) {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"" | "run" | "compare" | "save">("");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<RunResult[] | null>(null);
  const [compare, setCompare] = useState<Compare[] | null>(null);
  const [showSettings, setShowSettings] = useState(openSettings);

  useEffect(() => {
    fetch("/api/judgement/autorun", { cache: "no-store" }).then(async (r) => {
      const j = await r.json(); if (!r.ok) throw new Error(j.error || "Auto-judge is unavailable."); setInfo(j as Info);
    }).catch((e) => setError(e instanceof Error ? e.message : "Auto-judge is unavailable."));
  }, []);

  const cfg = info?.config;
  const live = Boolean(cfg && cfg.enabled && !cfg.shadow && Object.values(cfg.kinds).some(Boolean));
  const mode = !cfg ? "…" : live ? "On" : cfg.enabled && cfg.shadow ? "Shadow" : "Off";
  const summary = useMemo(() => {
    if (!results) return null;
    const finals = results.filter((r) => r.action === "FINAL"), would = results.filter((r) => r.action === "WOULD_FINAL"), skip = results.filter((r) => r.action === "SKIP");
    const reasons = new Map<string, number>();
    for (const r of skip) reasons.set(r.reason, (reasons.get(r.reason) || 0) + 1);
    return { finals, would, skip, topReasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4) };
  }, [results]);
  const agreement = useMemo(() => {
    if (!compare) return null;
    const decided = compare.filter((c) => c.agree !== null);
    const agree = decided.filter((c) => c.agree).length;
    return { checked: compare.length, decided: decided.length, agree, disagree: decided.length - agree, rate: decided.length ? Math.round(agree / decided.length * 1000) / 10 : null };
  }, [compare]);

  const mood: CatMood = error ? "error" : busy === "run" || busy === "compare" ? "thinking" : summary?.finals.length ? "success" : summary && summary.skip.length && !summary.finals.length && !summary.would.length ? "alert" : !pendingIds.length ? "empty" : "idle";

  async function post(body: unknown) {
    const r = await fetch("/api/judgement/autorun", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error || "Request failed."); return j;
  }
  async function run() {
    if (!pendingIds.length || busy) return;
    if (live && !window.confirm(`Auto-judge ${pendingIds.length.toLocaleString("en-US")} pending case(s)?\n\nCases the engine can decide completely, in the switched-on rule families, are saved as FINAL by "${info?.systemActor}". Everything else stays in your queue. Every decision is audited and can be reopened.`)) return;
    setBusy("run"); setError(""); setResults([]); setCompare(null); setProgress({ done: 0, total: pendingIds.length });
    const all: RunResult[] = [];
    try {
      for (let i = 0; i < pendingIds.length; i += CHUNK) {
        const j = await post({ action: "run", ids: pendingIds.slice(i, i + CHUNK) });
        all.push(...(j.results as RunResult[]));
        setResults([...all]); setProgress({ done: Math.min(i + CHUNK, pendingIds.length), total: pendingIds.length });
        const finals = (j.results as RunResult[]).filter((r) => r.action === "FINAL" && r.decision).map((r) => ({ id: r.id, decision: r.decision as "OK" | "NG" }));
        if (finals.length) onFinal(finals, info?.systemActor || "Auto-judgement (System)");
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Auto-judge stopped."); }
    finally { setBusy(""); }
  }
  async function runCompare() {
    if (!judgedIds.length || busy) return;
    setBusy("compare"); setError(""); setCompare([]); setProgress({ done: 0, total: judgedIds.length });
    const all: Compare[] = [];
    try {
      for (let i = 0; i < judgedIds.length; i += CHUNK) {
        const j = await post({ action: "compare", ids: judgedIds.slice(i, i + CHUNK) });
        all.push(...(j.results as Compare[])); setCompare([...all]); setProgress({ done: Math.min(i + CHUNK, judgedIds.length), total: judgedIds.length });
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Comparison stopped."); }
    finally { setBusy(""); }
  }
  async function save(next: Config) {
    if (!info) return;
    setBusy("save"); setError("");
    try {
      const r = await fetch("/api/judgement/autorun", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: next, baseVersion: info.version }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || "Could not save.");
      setInfo({ ...info, config: j.config, version: j.version });
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save."); }
    finally { setBusy(""); }
  }

  const pct = progress.total ? Math.round(progress.done / progress.total * 100) : 0;
  return <section className="aj" aria-labelledby="aj-title">
    <div className="aj-top">
      <CatStage mood={mood} size={104}/>
      <div className="aj-copy">
        <span className="aj-kicker"><Bot size={13}/> AUTO-JUDGE <b className={"aj-mode " + mode.toLowerCase()}>{mode}</b></span>
        <h2 id="aj-title">{live ? "Let the system judge what it can" : "See what the system would judge"}</h2>
        <p>{live
          ? "Complete cases in the switched-on rule families are saved as FINAL automatically, with the full trace. Everything else stays with you."
          : "Runs every pending case through the rules and shows which ones it could decide on its own. Nothing is written until an admin turns auto-judge on."}</p>
      </div>
      <div className="aj-actions">
        <button type="button" className="aj-primary" onClick={() => void run()} disabled={!!busy || !info?.canRun || !pendingIds.length}>
          {busy === "run" ? <LoaderCircle size={15} className="spin"/> : <Play size={15}/>} {live ? "Auto-judge" : "Preview"} {pendingIds.length.toLocaleString("en-US")} pending
        </button>
        <div className="aj-secondary">
          <button type="button" onClick={() => void runCompare()} disabled={!!busy || !judgedIds.length} title="Compare the engine with decisions people already made"><Scale size={14}/> Accuracy check</button>
          {info?.canConfigure && <button type="button" onClick={() => setShowSettings((v) => !v)} aria-expanded={showSettings}><Settings2 size={14}/> Rules</button>}
        </div>
      </div>
    </div>

    {(busy === "run" || busy === "compare") && <div className="aj-progress" role="status"><div className="aj-bar"><i style={{ width: pct + "%" }}/></div><span>{progress.done.toLocaleString("en-US")} / {progress.total.toLocaleString("en-US")}</span></div>}
    {error && <div className="aj-error" role="alert"><AlertTriangle size={14}/><span>{error}</span></div>}
    {info && cfg && cfg.enabled && info.ruleSet && cfg.ruleSet !== info.ruleSet && <div className="aj-note"><AlertTriangle size={14}/><span>The rules were updated to {info.ruleSetLabel}. Nothing is finalised automatically until an admin reviews the rule families and re-approves.{info.canConfigure ? " " : ""}</span>{info.canConfigure && <button type="button" className="aj-reapprove" disabled={busy === "save"} onClick={() => void save({ ...cfg })}><ShieldCheck size={13}/> Re-approve for {info.ruleSetLabel}</button>}</div>}
    {info?.missing && <div className="aj-note"><AlertTriangle size={14}/><span>Auto-judge settings are not stored yet, so it stays in preview. {info.migrationHint}</span></div>}

    {summary && <div className="aj-stats">
      <div className="ok"><strong>{summary.finals.filter((r) => r.decision === "OK").length + (live ? 0 : summary.would.filter((r) => r.decision === "OK").length)}</strong><span>{live ? "Final OK saved" : "Would be OK"}</span></div>
      <div className="ng"><strong>{summary.finals.filter((r) => r.decision === "NG").length + (live ? 0 : summary.would.filter((r) => r.decision === "NG").length)}</strong><span>{live ? "Final NG saved" : "Would be NG"}</span></div>
      {live && summary.would.length > 0 && <div><strong>{summary.would.length}</strong><span>Decided, family switched off</span></div>}
      <div className="hold"><strong>{summary.skip.length}</strong><span>Need a person</span></div>
    </div>}
    {summary && summary.topReasons.length > 0 && <details className="aj-why"><summary>Why cases still need a person</summary><ul>{summary.topReasons.map(([reason, n]) => <li key={reason}><b>{n}</b> {reason}</li>)}</ul></details>}

    {agreement && <div className="aj-agree" role="status">
      <ShieldCheck size={15}/><span>Accuracy check on {agreement.checked.toLocaleString("en-US")} judged case(s): the engine could decide {agreement.decided.toLocaleString("en-US")}; it agrees with people on <b>{agreement.agree}</b>{agreement.rate !== null ? ` (${agreement.rate}%)` : ""} and differs on <b>{agreement.disagree}</b>.</span>
    </div>}

    {showSettings && cfg && <div className="aj-settings">
      <label className="aj-switch"><input type="checkbox" checked={cfg.enabled} disabled={busy === "save" || info?.missing} onChange={(e) => void save({ ...cfg, enabled: e.target.checked })}/><span><Power size={14}/> Auto-judge {cfg.enabled ? "on" : "off"}</span><small>Master switch. Off = preview only.</small></label>
      <label className="aj-switch"><input type="checkbox" checked={cfg.shadow} disabled={busy === "save" || info?.missing} onChange={(e) => void save({ ...cfg, shadow: e.target.checked })}/><span>Shadow mode</span><small>Decide but do not write. Use for a few days with the accuracy check before going live.</small></label>
      <fieldset className="aj-kinds"><legend>Rule families that may be finalised automatically</legend>
        {(Object.keys(KIND_LABEL) as Kind[]).map((k) => <label key={k}><input type="checkbox" checked={cfg.kinds[k]} disabled={busy === "save" || info?.missing} onChange={(e) => void save({ ...cfg, kinds: { ...cfg.kinds, [k]: e.target.checked } })}/> {KIND_LABEL[k]}</label>)}
      </fieldset>
      <p className="aj-fine">Error Type 19, HOLD, missing evidence and flows that are not encoded are never finalised. {cfg.approvedBy ? `Last approved by ${cfg.approvedBy} on ${String(cfg.approvedAt || "").slice(0, 10)}${cfg.ruleSet && info?.ruleSet && cfg.ruleSet === info.ruleSet ? ` for ${info.ruleSetLabel}` : " (older rule set)"}.` : "Not approved yet."} Flows marked draft in their source (MCCP) are never finalised.</p>
    </div>}
  </section>;
}
