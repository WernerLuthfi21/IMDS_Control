"use client";
import { useState } from "react";
import { Eye, EyeOff, LoaderCircle, LogIn, Mail, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Mode = "signin" | "request";

export function LoginForm({ next, accessEmail }: { next: string; accessEmail: string }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [req, setReq] = useState({ name: "", company: "", email: "", kind: "supplier", note: "" });

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError("");
    const supabase = createClient();
    if (!supabase) { setError("Sign-in is not configured for this deployment. Contact the administrator."); setLoading(false); return; }
    const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (authError) { setError(authError.message === "Invalid login credentials" ? "Email or password is incorrect." : authError.message); setLoading(false); return; }
    // Hard navigation: the server must see the new session cookies, and the role decides where the user lands.
    window.location.assign(next);
  }

  const mailto = accessEmail
    ? `mailto:${accessEmail}?subject=${encodeURIComponent("IMDS workspace access request")}&body=${encodeURIComponent(
        `Name: ${req.name}\nCompany: ${req.company}\nEmail: ${req.email}\nAccount type: ${req.kind === "supplier" ? "Supplier (self-check only)" : "TMMIN staff"}\nNote: ${req.note}`)}`
    : "";
  const requestReady = Boolean(req.name.trim() && req.company.trim() && /\S+@\S+\.\S+/.test(req.email));

  return <main className="auth-page">
    <div className="auth-card">
      <div className="auth-brand"><Sparkles size={14}/> TMMIN · IMDS WORKSPACE</div>
      <h1>{mode === "signin" ? "Sign in" : "Request access"}</h1>
      <p className="auth-lead">{mode === "signin" ? "Use your account to continue. Your workspace follows your role." : "Accounts are created by the IMDS administrator."}</p>
      <div className="auth-tabs" role="tablist" aria-label="Access">
        <button type="button" role="tab" aria-selected={mode === "signin"} className={mode === "signin" ? "on" : ""} onClick={() => { setMode("signin"); setError(""); }}>Sign in</button>
        <button type="button" role="tab" aria-selected={mode === "request"} className={mode === "request" ? "on" : ""} onClick={() => { setMode("request"); setError(""); }}>Request access</button>
      </div>

      {mode === "signin" ? <form onSubmit={signIn} noValidate={false}>
        <label className="auth-field"><span>Email</span>
          <input type="email" required autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)}/></label>
        <label className="auth-field"><span>Password</span>
          <span className="auth-pass"><input type={showPassword ? "text" : "password"} required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}/>
            <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}>{showPassword ? <EyeOff size={16}/> : <Eye size={16}/>}</button></span></label>
        <div className="auth-error" role="alert" aria-live="polite">{error}</div>
        <button className="auth-submit" disabled={loading}>{loading ? <LoaderCircle className="spin" size={15}/> : <LogIn size={15}/>} {loading ? "Signing in…" : "Sign in"}</button>
      </form> : <div>
        <div className="auth-field-row">
          <label className="auth-field"><span>Full name</span><input value={req.name} onChange={(e) => setReq({ ...req, name: e.target.value })} autoComplete="name"/></label>
          <label className="auth-field"><span>Company</span><input value={req.company} onChange={(e) => setReq({ ...req, company: e.target.value })} autoComplete="organization"/></label>
        </div>
        <label className="auth-field"><span>Work email</span><input type="email" value={req.email} onChange={(e) => setReq({ ...req, email: e.target.value })} autoComplete="email"/></label>
        <fieldset className="auth-kind"><legend>I am a</legend>
          <label><input type="radio" name="kind" checked={req.kind === "supplier"} onChange={() => setReq({ ...req, kind: "supplier" })}/> Supplier <small>Self-check only</small></label>
          <label><input type="radio" name="kind" checked={req.kind === "tmmin"} onChange={() => setReq({ ...req, kind: "tmmin" })}/> TMMIN staff <small>Tracker &amp; Judgement</small></label></fieldset>
        <label className="auth-field"><span>Note (optional)</span><input value={req.note} onChange={(e) => setReq({ ...req, note: e.target.value })}/></label>
        {accessEmail
          ? <a className={`auth-submit ${requestReady ? "" : "disabled"}`} href={requestReady ? mailto : undefined} aria-disabled={!requestReady}><Mail size={15}/> Prepare email to administrator</a>
          : <div className="auth-note">Access requests are not wired to an inbox yet. Please contact your IMDS administrator directly to get an account.</div>}
        <p className="auth-hint">This prepares an email draft only. Nothing is sent until you send it from your mail app, and access is granted manually by an administrator.</p>
      </div>}
    </div>
    <p className="auth-foot">Private TMMIN workspace · Access follows your account role</p>
  </main>;
}
