"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Activity, ArrowLeft, ArrowUpRight, ClipboardList, FileClock, Inbox, LayoutGrid, Mail, Menu, Moon, Search, Settings2, ShieldCheck, Sun, X } from "lucide-react";
import { SignOutButton } from "@/components/sign-out-button";
import { SyncPill } from "@/components/sync-pill";
import { CommandPalette } from "@/components/command-palette";
import { ConfirmHost } from "@/components/ui/confirm-dialog";

const navigation = [
  { label: "Judgement Register", href: "/judgement", icon: ClipboardList, group: "WORK" },
  { label: "Daily G-CATS Update", href: "/daily-update", icon: FileClock, group: "WORK" },
  { label: "Supplier Pre-check", href: "/supplier-precheck", icon: Inbox, group: "SUPPLIER" },
  { label: "Supplier Follow-up", href: "/follow-up", icon: Mail, group: "SUPPLIER" },
  { label: "Substance References", href: "/substances", icon: Activity, group: "REFERENCE" },
  { label: "Judgement Rules", href: "/rules", icon: ShieldCheck, group: "REFERENCE" },
  { label: "Settings", href: "/settings", icon: Settings2, group: "ADMIN" }
];

export function AppShell({ children, role, email }: { children: React.ReactNode; role: string; email?: string | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  // The layout's head script sets data-theme before the first paint; this only mirrors it for the toggle icon.
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setTheme(root.dataset.theme === "dark" ? "dark" : "light");
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    const id = window.requestAnimationFrame(read);
    return () => { observer.disconnect(); window.cancelAnimationFrame(id); };
  }, []);
  // A file dropped outside a drop zone must not make the browser open it and leave the app.
  useEffect(() => {
    const outside = (e: DragEvent) => {
      if (!Array.from(e.dataTransfer?.types || []).includes("Files")) return;
      if ((e.target as Element | null)?.closest?.("[data-dropzone]")) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
    };
    window.addEventListener("dragover", outside);
    window.addEventListener("drop", outside);
    return () => { window.removeEventListener("dragover", outside); window.removeEventListener("drop", outside); };
  }, []);
  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem("imds-theme", next);
  }
  const visibleNavigation = role === "supplier" ? navigation.filter((item) => item.href === "/supplier-precheck").map((item) => ({ ...item, label: "Self-check" })) : navigation;
  const active = visibleNavigation.find((item) => item.href === pathname || (item.href !== "/" && pathname.startsWith(item.href + "/"))) || visibleNavigation.find((item) => item.href === "/judgement") || visibleNavigation[0];
  const paletteItems = [
    ...visibleNavigation.map((n) => ({ id: n.href, label: n.label, group: "Go to", href: n.href, keywords: n.group })),
    ...(role !== "supplier" ? [
      { id: "judge", label: "Judge the next case", group: "Judgement", href: "/judgement", keywords: "deck card queue" },
      { id: "all", label: "All cases (register table)", group: "Judgement", href: "/judgement?q=", keywords: "list table" },
      { id: "auto", label: "Auto-judge rule families", group: "Judgement", href: "/judgement?autojudge=settings", keywords: "miko automatic" },
      { id: "tracker", label: "IMDS Tracker", group: "Go to", href: "/imds-tracker", keywords: "purple models suppliers" },
      { id: "workspaces", label: "Back to menu (workspaces)", group: "Go to", href: "/workspace" }
    ] : [])
  ];
  function searchSubmit(e: React.FormEvent) { e.preventDefault(); const q = query.trim(); if (q) router.push(`/judgement?q=${encodeURIComponent(q)}`); }
  const themeButton = <button type="button" className="theme-toggle shell-theme" onClick={toggleTheme} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} title={theme === "dark" ? "Light mode" : "Dark mode"}>{theme === "dark" ? <Sun size={16}/> : <Moon size={16}/>}</button>;
  if (["/login", "/forgot-password", "/reset-password"].includes(pathname)) return <div className="auth-shell">{themeButton}{children}<ConfirmHost/></div>;
  if (pathname === "/tracker-workbench") return <>{children}</>;
  if (pathname === "/workspace") return <div className="workspace-selector-shell">{themeButton}{children}<ConfirmHost/></div>;
  return <div className="app-frame"><ConfirmHost/>
    <a className="skip-link" href="#main-content">Skip to content</a>
    {mobileOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)}/>}
    <aside id="app-sidebar" className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`} onKeyDown={(e) => { if (e.key === "Escape" && mobileOpen) setMobileOpen(false); }}>
      <div className="brand-lockup"><div className="brand-mark">IM</div><div><div className="brand-title">IMDS / G-CATS</div><div className="brand-subtitle">IMDS CONTROL CENTER</div></div><button className="icon-button mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close"><X size={17}/></button></div>
      {role !== "supplier" ? <Link className="back-menu" href="/workspace"><ArrowLeft size={15}/><span>Back to menu</span></Link>
        : <div className="workspace-chip"><span className="workspace-dot"/> SUPPLIER PORTAL</div>}
      <nav className="nav-list" aria-label="Main">{(role === "supplier" ? ["SUPPLIER"] as const : ["WORK", "SUPPLIER", "REFERENCE", "ADMIN"] as const).map((group) => <div className="nav-group" key={group}><div className="nav-group-label">{group}</div>{visibleNavigation.filter((item) => item.group === group).map((item) => { const Icon = item.icon; const isActive = active?.href === item.href; return <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)} className={`nav-item ${isActive ? "nav-active" : ""}`} aria-current={isActive ? "page" : undefined}><Icon size={17}/><span>{item.label}</span>{isActive && <span className="nav-active-indicator"/>}</Link>; })}</div>)}</nav>
      <div className="sidebar-bottom side-foot">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="brand-logo" src="/toyota-indonesia.png" alt="PT Toyota Motor Manufacturing Indonesia" width={120} height={51}/>
        <div className="user-row">
          <div className="avatar" aria-hidden="true">{(email || "IM").slice(0, 2).toUpperCase()}</div>
          <div className="profile-copy"><strong title={email || ""}>{email || "Workspace user"}</strong><span>{role === "supplier" ? "Supplier account" : role || "Internal"}</span></div>
          <Link className="icon-button" href="/settings" title="Settings" aria-label="Settings"><Settings2 size={16}/></Link>
          <SignOutButton compact/>
        </div>
        <span className="confidential">PROTECTED · internal use only</span>
      </div>
    </aside>
    <main className="main-area">
      <header className="topbar"><button className="icon-button mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation" aria-expanded={mobileOpen} aria-controls="app-sidebar"><Menu size={19}/></button>{role !== "supplier" && <Link className="workspace-switch-link" href="/workspace" title="Switch workspace"><LayoutGrid size={15}/><span>Workspaces</span></Link>}<div className="breadcrumb"><span>IMDS / G-CATS</span><span className="breadcrumb-divider">/</span><strong>{active?.label || "Judgement Register"}</strong></div><form className="global-search" onSubmit={searchSubmit}><Search size={16}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find part no., supplier, error type or code…" aria-label="Global search"/><button type="button" className="kbd-btn" onClick={() => window.dispatchEvent(new Event("imds:palette"))} title="Command palette (Ctrl/⌘ K)" aria-label="Open the command palette"><kbd>Ctrl K</kbd></button></form><div className="topbar-actions"><button type="button" className="icon-button mobile-search" onClick={() => window.dispatchEvent(new Event("imds:palette"))} aria-label="Search and commands"><Search size={17}/></button>{role !== "supplier" && <SyncPill/>}<button type="button" className="theme-toggle" onClick={toggleTheme} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} title={theme === "dark" ? "Light mode" : "Dark mode"}>{theme === "dark" ? <Sun size={16}/> : <Moon size={16}/>}<span>{theme === "dark" ? "Light" : "Dark"}</span></button><span className="environment-pill"><span/> PRIVATE WORKSPACE</span></div></header>
      <div className="content-area" id="main-content" tabIndex={-1}>{children}</div>
      <CommandPalette items={paletteItems} onTheme={toggleTheme}/>
      <footer className="app-footer"><span>IMDS / G-CATS CONTROL CENTER</span><span>Source-traceable · Human-approved</span><span className="footer-version">V0.2.2 <ArrowUpRight size={11}/></span></footer>
    </main>
  </div>;
}
