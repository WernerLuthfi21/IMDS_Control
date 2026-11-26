"use client";
import { useEffect, useId, useState, type ReactNode, type KeyboardEvent } from "react";

export type SettingsTab = { id: string; label: string; hint: string; content: ReactNode };

/** Settings grouped by what you are setting up. The tab is kept in the URL hash (#judgement, #tracker …). */
export function SettingsTabs({ tabs, compact = false, syncHash = true, label = "Settings sections", initialId }: { tabs: SettingsTab[]; compact?: boolean; syncHash?: boolean; label?: string; initialId?: string }) {
  const prefix = useId();
  const [active, setActive] = useState(initialId || tabs[0]?.id || "");
  const [visited, setVisited] = useState<string[]>([initialId || tabs[0]?.id || ""]);
  const selected = tabs.find((t) => t.id === active) || tabs[0];
  useEffect(() => {
    if (!syncHash) return;
    const read = () => { const h = window.location.hash.slice(1); if (tabs.some((t) => t.id === h)) { setActive(h); setVisited(v => v.includes(h) ? v : [...v,h]); } };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [tabs, syncHash]);
  function pick(id: string) { setActive(id); setVisited(v => v.includes(id) ? v : [...v,id]); if (syncHash) window.history.replaceState(null, "", "#" + id); }
  function onKey(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (index + 1) % tabs.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (index + tabs.length - 1) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;
    e.preventDefault(); pick(tabs[next].id); document.getElementById(prefix + "-tab-" + tabs[next].id)?.focus();
  }
  return <div className={compact ? "st st-compact" : "st"}>
    <nav className="st-nav" role="tablist" aria-label={label} aria-orientation={compact ? "horizontal" : undefined}>
      {tabs.map((t, index) => <button type="button" role="tab" key={t.id} id={prefix + "-tab-" + t.id} aria-selected={t.id === selected?.id} aria-controls={prefix + "-panel-" + t.id} tabIndex={t.id === selected?.id ? 0 : -1}
        className={t.id === selected?.id ? "on" : ""} onClick={() => pick(t.id)} onKeyDown={e => onKey(e,index)}>
        <strong>{t.label}</strong><span>{t.hint}</span></button>)}
    </nav>
    {tabs.map(t => <div key={t.id} className="st-panel" role="tabpanel" id={prefix + "-panel-" + t.id} aria-labelledby={prefix + "-tab-" + t.id} hidden={t.id !== selected?.id}>{(visited.includes(t.id) || t.id === selected?.id) && t.content}</div>)}
  </div>;
}

/** A link card to where a setting actually lives (one place per setting, no copies). */
export function SettingLink({ href, title, children, action, tone = "green" }: { href: string; title: string; children: ReactNode; action: string; tone?: "green" | "violet" | "neutral" }) {
  return <a className={"st-link " + tone} href={href}>
    <div><strong>{title}</strong><span>{children}</span></div>
    <em>{action} →</em>
  </a>;
}
