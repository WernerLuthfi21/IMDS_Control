"use client";
import { useState, type ReactNode } from "react";

/** Supplier Pre-check: one tool at a time so each fits a laptop screen. */
export function PrecheckTabs({ tabs }: { tabs: Array<{ id: string; label: string; hint: string; content: ReactNode }> }) {
  const [active, setActive] = useState(tabs[0]?.id || "");
  const tab = tabs.find((t) => t.id === active) || tabs[0];
  return <div className="pt">
    <div className="pt-tabs" role="tablist" aria-label="Pre-check tools">
      {tabs.map((t) => <button type="button" role="tab" key={t.id} id={"pt-" + t.id} aria-selected={t.id === tab?.id} aria-controls={"pt-panel-" + t.id} className={t.id === tab?.id ? "on" : ""} onClick={() => setActive(t.id)}>
        <strong>{t.label}</strong><span>{t.hint}</span></button>)}
    </div>
    {tab && <div role="tabpanel" id={"pt-panel-" + tab.id} aria-labelledby={"pt-" + tab.id}>{tab.content}</div>}
  </div>;
}
