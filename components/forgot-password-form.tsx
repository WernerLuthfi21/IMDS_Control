"use client";
import { useState } from "react";
import { ArrowLeft, LoaderCircle, MailCheck } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    const supabase = createClient();
    if (!supabase) { setError("Password recovery is not available."); setBusy(false); return; }
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: new URL("/reset-password", window.location.origin).toString()
    });
    if (resetError) setError("The recovery email could not be requested. Please try again or contact the administrator.");
    else setDone(true);
    setBusy(false);
  }
  return <main className="auth-page"><section className="auth-panel">
    <div className="auth-brand"><span className="auth-brand-mark">IM</span><span>TMMIN <i>·</i> IMDS WORKSPACE</span></div>
    <h1>Reset your password</h1>
    {done ? <div className="auth-success"><MailCheck size={27}/><strong>Check your email</strong><p>If the address is registered, a password recovery link will be sent.</p></div> : <>
      <p>Enter the work email associated with your account.</p>
      <form onSubmit={submit}>
        <label className="auth-field"><span>Work email</span><input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        {error && <div className="auth-error" role="alert">{error}</div>}
        <button className="auth-submit" disabled={busy}>{busy ? <LoaderCircle size={16} className="spin"/> : null} Send recovery link</button>
      </form>
    </>}
    <Link className="auth-back" href="/login"><ArrowLeft size={14}/> Back to sign in</Link>
  </section></main>;
}
