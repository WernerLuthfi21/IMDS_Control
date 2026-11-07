"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";

type S = { configured: { excel: boolean; email: boolean }; counts: Record<string, number> };

/** Shows Excel-sync health and quietly retries queued jobs while any internal user has the app open. */
export function SyncPill() {
  const [s, setS] = useState<S | null>(null);
  useEffect(() => {
    let stop = false;
    async function tick() {
      if (document.hidden) return;
      try {
        const r = await fetch("/api/automation/status", { cache: "no-store" });
        if (!r.ok || stop) return;
        const j: S = await r.json();
        const waiting = (j.counts["EXCEL_UPSERT:PENDING"] || 0) + (j.counts["EXCEL_UPSERT:FAILED"] || 0) + (j.counts["EXCEL_UPSERT:SENDING"] || 0);
        if (j.configured.excel && waiting > 0) { await fetch("/api/automation/dispatch", { method: "POST" }); const r2 = await fetch("/api/automation/status", { cache: "no-store" }); if (r2.ok && !stop) { setS(await r2.json()); return; } }
        if (!stop) setS(j);
      } catch { /* offline: keep the last state */ }
    }
    const first = setTimeout(() => { void tick(); }, 1500);
    const t = setInterval(() => { void tick(); }, 60000);
    return () => { stop = true; clearTimeout(first); clearInterval(t); };
  }, []);
  if (!s) return null;
  const waiting = (s.counts["EXCEL_UPSERT:PENDING"] || 0) + (s.counts["EXCEL_UPSERT:SENDING"] || 0);
  const failed = s.counts["EXCEL_UPSERT:FAILED"] || 0;
  const label = !s.configured.excel ? "Excel sync: not set up" : failed ? `Excel sync: ${failed} failed` : waiting ? `Excel sync: ${waiting} waiting` : "Excel in sync";
  const Icon = !s.configured.excel || failed ? AlertTriangle : waiting ? RefreshCw : CheckCircle2;
  return <Link href="/follow-up#automation" className="environment-pill" title="Open the Power Automate panel" style={{ textDecoration: "none" }}><Icon size={12}/> {label}</Link>;
}
