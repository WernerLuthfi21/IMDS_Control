"use client";
import { useState } from "react";
import { LoaderCircle, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton({ compact = false }: { compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  async function signOut() {
    setBusy(true);
    try { await createClient()?.auth.signOut(); } finally { window.location.assign("/login"); }
  }
  return <button type="button" className={compact ? "icon-button" : "btn btn-sm"} onClick={signOut} disabled={busy} title="Sign out" aria-label="Sign out">
    {busy ? <LoaderCircle className="spin" size={15}/> : <LogOut size={compact ? 17 : 14}/>}{!compact && <span>Sign out</span>}
  </button>;
}
