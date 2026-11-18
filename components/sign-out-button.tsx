"use client";
import { useState } from "react";
import { LoaderCircle, LogOut } from "lucide-react";

/**
 * Signs out through the server route (POST /auth/signout clears the Supabase cookies and redirects to
 * /login). A plain form post: no Supabase client in the browser bundle of every page just for this button.
 */
export function SignOutButton({ compact = false }: { compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  return <form action="/auth/signout" method="post" className="signout-form" onSubmit={() => setBusy(true)}>
    <button type="submit" className={compact ? "icon-button" : "btn btn-sm"} disabled={busy} title="Sign out" aria-label="Sign out">
      {busy ? <LoaderCircle className="spin" size={15}/> : <LogOut size={compact ? 17 : 14}/>}{!compact && <span>Sign out</span>}
    </button>
  </form>;
}
