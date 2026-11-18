"use client";
import { useEffect, useState, type ReactNode } from "react";

export type SettingsTab = { id: string; label: string; hint: string; content: ReactNode };

/** Settings grouped by what you are setting up. The tab is kept in the URL hash (#judgement, #tracker …). */
export function SettingsTabs({ tabs }: { tabs: SettingsTab[] }) {
  const [active, setActive] = useState(tabs[0]?.id || "");
  useEffect(() => {
    const read = () => { const h = window.location.hash.slice(1); if (tabs.some((t) => t.id === h)) setActive(h); };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [tabs]);
  const pick = (id: string) => { setActive(id); window.history.replaceState(null, "", "#" + id); };
  const tab = tabs.find((t) => t.id === active) || tabs[0];
  return <div className="st">
    <nav className="st-nav" role="tablist" aria-label="Settings sections">
      {tabs.map((t) => <button type="button" role="tab" key={t.id} id={"st-tab-" + t.id} aria-selected={t.id === tab?.id} aria-controls={"st-panel-" + t.id}
        className={t.id === tab?.id ? "on" : ""} onClick={() => pick(t.id)}>
        <strong>{t.label}</strong><span>{t.hint}</span></button>)}
    </nav>
    {tab && <div className="st-panel" role="tabpanel" id={"st-panel-" + tab.id} aria-labelledby={"st-tab-" + tab.id}>{tab.content}</div>}
  </div>;
}

/** A link card to where a setting actually lives (one place per setting, no copies). */
export function SettingLink({ href, title, children, action, tone = "green" }: { href: string; title: string; children: ReactNode; action: string; tone?: "green" | "violet" | "neutral" }) {
  return <a className={"st-link " + tone} href={href}>
    <div><strong>{title}</strong><span>{children}</span></div>
    <em>{action} →</em>
  </a>;
}
