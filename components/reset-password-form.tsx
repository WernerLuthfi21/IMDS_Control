"use client";
import { useState } from "react";
import { Eye, EyeOff, KeyRound, LoaderCircle, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function ResetPasswordForm() {
  const [pw, setPw] = useState(""); const [pw2, setPw2] = useState(""); const [show, setShow] = useState(false);
  const [error, setError] = useState(""); const [loading, setLoading] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError("");
    if (pw.length < 10) return setError("Use at least 10 characters.");
    if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return setError("Include letters and at least one digit.");
    if (pw !== pw2) return setError("Passwords do not match.");
    setLoading(true);
    const supabase = createClient();
    const { error: err } = supabase ? await supabase.auth.updateUser({ password: pw }) : { error: { message: "Not configured." } };
    if (err) { setError(err.message); setLoading(false); return; }
    window.location.assign("/workspace");
  }
  return <main className="auth-page"><div className="auth-card">
    <div className="auth-brand"><Sparkles size={14}/> TMMIN · IMDS WORKSPACE</div>
    <h1>New password</h1>
    <form onSubmit={submit}>
      <label className="auth-field"><span>New password</span><span className="auth-pass"><input type={show ? "text" : "password"} required autoFocus autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)}/>
        <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"} aria-pressed={show}>{show ? <EyeOff size={16}/> : <Eye size={16}/>}</button></span></label>
      <label className="auth-field"><span>Repeat password</span><input type={show ? "text" : "password"} required autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)}/></label>
      <div className="auth-error" role="alert" aria-live="polite">{error}</div>
      <button className="auth-submit" disabled={loading}>{loading ? <LoaderCircle className="spin" size={15}/> : <KeyRound size={15}/>} Save password</button>
    </form>
  </div></main>;
}
