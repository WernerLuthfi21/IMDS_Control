"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Activity, ArrowUpRight, ClipboardList, FileClock, Inbox, LayoutGrid, Mail, Menu, Search, Settings2, ShieldCheck, X } from "lucide-react";
import { SignOutButton } from "@/components/sign-out-button";
import { SyncPill } from "@/components/sync-pill";

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
  const visibleNavigation = role === "supplier" ? navigation.filter((item) => item.href === "/supplier-precheck").map((item) => ({ ...item, label: "Self-check" })) : navigation;
  const active = visibleNavigation.find((item) => item.href === pathname || (item.href !== "/" && pathname.startsWith(item.href + "/"))) || visibleNavigation.find((item) => item.href === "/judgement") || visibleNavigation[0];
  function searchSubmit(e: React.FormEvent) { e.preventDefault(); const q = query.trim(); if (q) router.push(`/judgement?q=${encodeURIComponent(q)}`); }
  if (["/login", "/forgot-password", "/reset-password"].includes(pathname)) return <div className="auth-shell">{children}</div>;
  if (pathname === "/workspace") return <div className="workspace-selector-shell">{children}</div>;
  return <div className="app-frame">
    {mobileOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)}/>}
    <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
      <div className="brand-lockup"><div className="brand-mark">IM</div><div><div className="brand-title">IMDS / G-CATS</div><div className="brand-subtitle">IMDS CONTROL CENTER</div></div><button className="icon-button mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close"><X size={17}/></button></div>
      <div className="workspace-chip"><span className="workspace-dot"/> {role === "supplier" ? "SUPPLIER PORTAL" : "INTERNAL WORKSPACE"} <span className="chevron">⌄</span></div>
      <nav className="nav-list">{(role === "supplier" ? ["SUPPLIER"] as const : ["WORK", "SUPPLIER", "REFERENCE", "ADMIN"] as const).map((group) => <div className="nav-group" key={group}><div className="nav-group-label">{group}</div>{visibleNavigation.filter((item) => item.group === group).map((item) => { const Icon = item.icon; const isActive = active?.href === item.href; return <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)} className={`nav-item ${isActive ? "nav-active" : ""}`}><Icon size={17}/><span>{item.label}</span>{isActive && <span className="nav-active-indicator"/>}</Link>; })}</div>)}</nav>
      <div className="sidebar-bottom"><div className="secure-card"><ShieldCheck size={16}/><div><strong>{role === "supplier" ? "Submission readiness" : "Decision governance"}</strong><span>{role === "supplier" ? "Check MDS before IMDS submission" : "Human judgement stays in control"}</span></div></div><button className="profile-row" onClick={() => router.push("/settings")}><div className="avatar">IM</div><div className="profile-copy"><strong>{email || "Workspace user"}</strong><span>{role === "supplier" ? "Supplier account" : "Account & permissions"}</span></div><Settings2 size={15}/></button></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><button className="icon-button mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={19}/></button>{role !== "supplier" && <Link className="workspace-switch-link" href="/workspace" title="Switch workspace"><LayoutGrid size={15}/><span>Workspaces</span></Link>}<div className="breadcrumb"><span>IMDS / G-CATS</span><span className="breadcrumb-divider">/</span><strong>{active?.label || "Judgement Register"}</strong></div><form className="global-search" onSubmit={searchSubmit}><Search size={16}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find part no., supplier, error type or code…" aria-label="Global search"/><kbd>↵</kbd></form><div className="topbar-actions">{role !== "supplier" && <SyncPill/>}<span className="environment-pill"><span/> PRIVATE WORKSPACE</span>{role !== "supplier" && <button className="icon-button" title="Settings" onClick={() => router.push("/settings")}><Settings2 size={17}/></button>}<SignOutButton compact/></div></header>
      <div className="content-area">{children}</div>
      <footer className="app-footer"><span>IMDS / G-CATS CONTROL CENTER</span><span>Source-traceable · Human-approved</span><span className="footer-version">V0.2.2 <ArrowUpRight size={11}/></span></footer>
    </main>
  </div>;
}
