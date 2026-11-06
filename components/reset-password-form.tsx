"use client";
import { useState } from "react";
import { CheckCircle2, Eye, EyeOff, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export function ResetPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError("");
    if (password.length < 12) { setError("Use at least 12 characters."); return; }
    if (password !== confirm) { setError("The passwords do not match."); return; }
    setBusy(true);
    const supabase = createClient();
    if (!supabase) { setError("Password reset is not available."); setBusy(false); return; }
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) setError("The recovery link is invalid or expired. Request a new password reset link.");
    else { setDone(true); await supabase.auth.signOut(); }
    setBusy(false);
  }
  return <main className="auth-page"><section className="auth-panel">
    <div className="auth-brand"><span className="auth-brand-mark">IM</span><span>TMMIN <i>·</i> IMDS WORKSPACE</span></div>
    <h1>Create a new password</h1>
    {done ? <div className="auth-success"><CheckCircle2 size={27}/><strong>Password updated</strong><p>Your password has been changed. Sign in with the new password.</p><Link className="auth-submit auth-secondary" href="/login">Continue to sign in</Link></div> : <form onSubmit={submit}>
      <label className="auth-field"><span>New password</span><span className="auth-pass"><input required minLength={12} type={show ? "text" : "password"} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /><button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"}>{show ? <EyeOff size={16}/> : <Eye size={16}/>}</button></span></label>
      <label className="auth-field"><span>Confirm new password</span><input required minLength={12} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
      {error && <div className="auth-error" role="alert">{error}</div>}
      <button className="auth-submit" disabled={busy}>{busy ? <LoaderCircle size={16} className="spin"/> : null} Save new password</button>
    </form>}
    {!done && <Link className="auth-back" href="/login">Back to sign in</Link>}
  </section></main>;
}
