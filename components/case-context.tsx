"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, CircleCheck, CircleDashed, CircleHelp, Clock3, Cog, FileClock, LoaderCircle, Lock, Route, ShieldAlert } from "lucide-react";
import type { AutoOutput } from "@/lib/judgement/auto";
import type { HistoryKind, HistoryResponse } from "@/lib/judgement/history";
import { encodeTrail } from "@/lib/judgement/flow-path";
import { runCheck } from "@/lib/judgement/client-save";

const historyCache = new Map<string, HistoryResponse>();
const checkCache = new Map<string, AutoOutput>();
const KIND_LABEL: Record<HistoryKind, string> = { import: "Import", system: "System", supplier: "Supplier", reviewer: "Reviewer", judgement: "Judgement", rule: "Rule", admin: "Admin" };
const SOURCE_LABEL: Record<string, string> = {
  import_rows: "G-CATS snapshots", import_batches: "Import batches", register_change_log: "Change log", audit_events: "Audit log", judgement_runs: "Rule runs",
  approvals: "Approvals", supplier_followups: "Supplier follow-ups", judgement_memory: "Remembered answers", judgement_escalations: "TMC tracking", evidence: "Evidence", verification_tasks: "Tasks"
};
const fmt = (at: string | null, precision: string) => {
  if (!at) return "Undated";
  if (precision === "date") return new Date(at + "T00:00:00+07:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  return new Date(at).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

/**
 * The right-hand panel of the judgement table: what happened to this case (History, from records that
 * exist) and how the rules reach their answer. Mount with key={itemId} so each case starts fresh (Rule path, the engine's own steps, with a link that lights
 * the same path up on the flow chart). Loaded only when the panel is shown; cached per case.
 */
export function CaseContext({ itemId, partNo, check }: { itemId: string; partNo: string | null; check: AutoOutput | null }) {
  const [tab, setTab] = useState<"rule" | "history">("rule");
  const [hist, setHist] = useState<HistoryResponse | null>(historyCache.get(itemId) ?? null);
  const [histErr, setHistErr] = useState("");
  const [fetched, setFetched] = useState<AutoOutput | null>(checkCache.get(itemId) ?? null);
  const rule = check ?? fetched;
  const [ruleErr, setRuleErr] = useState("");

  useEffect(() => {
    if (tab !== "history" || hist) return;
    let gone = false;
    fetch(`/api/judgement/history?itemId=${encodeURIComponent(itemId)}`, { cache: "no-store" })
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "History is unavailable."); return j as HistoryResponse; })
      .then((j) => { historyCache.set(itemId, j); if (!gone) setHist(j); })
      .catch((e) => { if (!gone) setHistErr(e instanceof Error ? e.message : "History is unavailable."); });
    return () => { gone = true; };
  }, [tab, itemId, hist]);
  useEffect(() => {
    if (tab !== "rule" || rule) return;
    let gone = false;
    runCheck(itemId, {}).then((r) => { checkCache.set(itemId, r); if (!gone) setFetched(r); }).catch((e) => { if (!gone) setRuleErr(e instanceof Error ? e.message : "Rule check failed."); });
    return () => { gone = true; };
  }, [tab, itemId, rule]);

  const flow = rule?.flow;
  const pathHref = flow?.implemented ? `/rules?flow=${encodeURIComponent(flow.flowId)}&trail=${encodeTrail(flow.trail)}${partNo ? "&case=" + encodeURIComponent(partNo) : ""}` : null;
  const restricted = hist ? Object.entries(hist.sources).filter(([, v]) => v === "restricted").map(([k]) => SOURCE_LABEL[k] || k) : [];
  const unavailable = hist ? Object.entries(hist.sources).filter(([, v]) => v === "unavailable" || v === "error").map(([k]) => SOURCE_LABEL[k] || k) : [];

  return <aside className="cx" aria-label="Case context">
    <div className="cx-tabs" role="tablist" aria-label="Case context">
      <button type="button" role="tab" id="cx-t-rule" aria-controls="cx-p" aria-selected={tab === "rule"} className={tab === "rule" ? "on" : ""} onClick={() => setTab("rule")}><Route size={14} aria-hidden="true"/> Rule path</button>
      <button type="button" role="tab" id="cx-t-history" aria-controls="cx-p" aria-selected={tab === "history"} className={tab === "history" ? "on" : ""} onClick={() => setTab("history")}><FileClock size={14} aria-hidden="true"/> History</button>
    </div>
    <div className="cx-body" id="cx-p" role="tabpanel" aria-labelledby={tab === "rule" ? "cx-t-rule" : "cx-t-history"}>
      {tab === "rule" ? (
        ruleErr ? <p className="cx-empty err"><AlertTriangle size={14} aria-hidden="true"/> {ruleErr}</p>
        : !rule ? <p className="cx-empty"><LoaderCircle size={14} className="spin" aria-hidden="true"/> Running the rules…</p>
        : <>
          {flow && <div className="cx-flow"><span className="eyebrow">FLOW</span><strong>{flow.title}</strong><small>{flow.source}{flow.page ? ", p." + flow.page : ""}{flow.draft ? " · draft" : ""}</small></div>}
          <ol className="cx-steps">
            {rule.steps.map((s) => <li key={s.id} className={"st-" + s.status.toLowerCase()}>
              <span className="cx-ic" aria-hidden="true">{s.status === "DONE" ? (/\(auto\)$/.test(s.detail) ? <Cog size={13}/> : <CircleCheck size={13}/>) : s.status === "NEEDS_INPUT" ? <CircleHelp size={13}/> : s.status === "MANUAL" ? <AlertTriangle size={13}/> : <CircleDashed size={13}/>}</span>
              <span><b>{s.title}</b>{s.detail && <small>{s.detail}</small>}</span>
            </li>)}
          </ol>
          <div className={"cx-result " + rule.recommendation.state.toLowerCase()}><b>{rule.recommendation.state === "HOLD" ? "Not decided" : "Result " + rule.recommendation.state}</b><span>{rule.recommendation.reason}</span></div>
          {pathHref ? <a className="cx-link" href={pathHref}><Route size={14} aria-hidden="true"/> Show this path on the flow chart</a>
            : <p className="cx-note">No encoded flow chart for this case{flow?.page ? ` — follow the source, p.${flow.page}` : ""}.</p>}
        </>
      ) : (
        histErr ? <p className="cx-empty err"><AlertTriangle size={14} aria-hidden="true"/> {histErr}</p>
        : !hist ? <p className="cx-empty"><LoaderCircle size={14} className="spin" aria-hidden="true"/> Reading the records…</p>
        : <>
          {hist.events.length ? <ol className="cx-tl">
            {hist.events.map((e) => <li key={e.id} className={"k-" + e.kind}>
              <span className="cx-dot" aria-hidden="true"/>
              <div><span className="cx-when">{e.precision === "none" ? <><Clock3 size={11} aria-hidden="true"/> Undated</> : fmt(e.at, e.precision)}<i>{KIND_LABEL[e.kind]}</i></span>
                <b>{e.title}</b>{e.detail && <small>{e.detail}</small>}{e.actor && <em>by {e.actor}</em>}</div>
            </li>)}
          </ol> : <p className="cx-empty">No recorded events for this case yet.</p>}
          {restricted.length > 0 && <p className="cx-note"><Lock size={12} aria-hidden="true"/> Not visible to your role: {restricted.join(", ")}.</p>}
          {unavailable.length > 0 && <p className="cx-note"><ShieldAlert size={12} aria-hidden="true"/> Not available in this database: {unavailable.join(", ")}.</p>}
          <details className="cx-gaps"><summary>What is not recorded</summary><ul>{hist.notRecorded.map((n) => <li key={n}>{n}</li>)}</ul></details>
        </>
      )}
    </div>
  </aside>;
}
