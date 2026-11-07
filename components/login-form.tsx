"use client";
import { useState } from "react";
import { Eye, EyeOff, LoaderCircle, LogIn, Send, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Mode = "signin" | "request" | "forgot";

async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, error: (j.error as string) || "" };
}

export function LoginForm({ next, initialMode = "signin", linkError = false }: { next: string; initialMode?: Mode; linkError?: boolean }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(linkError ? "This link is invalid or has expired. Request a new one." : "");
  const [done, setDone] = useState("");
  const [helpSent, setHelpSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [req, setReq] = useState({ name: "", company: "", supplierCode: "", email: "", password: "", password2: "", website: "" });
  const go = (m: Mode) => { setMode(m); setError(""); setDone(""); setHelpSent(false); };

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError("");
    const supabase = createClient();
    if (!supabase) { setError("Sign-in is not configured for this deployment."); setLoading(false); return; }
    const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (authError) { setError(authError.message === "Invalid login credentials" ? "Email or password is incorrect." : /not confirmed/i.test(authError.message) ? "This account is not active yet. Ask an administrator." : /banned/i.test(authError.message) ? "This account is waiting for approval." : authError.message); setLoading(false); return; }
    // Hard navigation: the server must see the new session cookies, and the role decides where the user lands.
    window.location.assign(next);
  }
  async function submitRequest(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError("");
    const r = await post("/api/access/request", req);
    setLoading(false);
    if (!r.ok) { setError(r.error || "Could not submit the request."); return; }
    setDone("Request submitted."); setReq((x) => ({ ...x, password: "", password2: "" }));
  }
  async function submitForgot(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError("");
    const r = await post("/api/auth/forgot", { email });
    setLoading(false);
    if (!r.ok) { setError(r.error || "Could not send the link."); return; }
    setDone("If this email has an account, a reset link is on its way.");
  }
  async function askAdmin() {
    setLoading(true);
    await post("/api/access/password-help", { email, website: "" });
    setLoading(false); setHelpSent(true);
  }

  return <main className="auth-page">
    <div className="auth-card">
      <div className="auth-brand"><Sparkles size={14}/> TMMIN · IMDS WORKSPACE</div>
      <h1>{mode === "signin" ? "Sign in" : mode === "request" ? "Request access" : "Reset password"}</h1>
      {mode !== "forgot" && <div className="auth-tabs" role="tablist" aria-label="Access">
        <button type="button" role="tab" aria-selected={mode === "signin"} className={mode === "signin" ? "on" : ""} onClick={() => go("signin")}>Sign in</button>
        <button type="button" role="tab" aria-selected={mode === "request"} className={mode === "request" ? "on" : ""} onClick={() => go("request")}>Request access</button>
      </div>}

      {mode === "signin" && <form onSubmit={signIn}>
        <label className="auth-field"><span>Email</span>
          <input type="email" required autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)}/></label>
        <label className="auth-field"><span>Password</span>
          <span className="auth-pass"><input type={showPassword ? "text" : "password"} required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}/>
            <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}>{showPassword ? <EyeOff size={16}/> : <Eye size={16}/>}</button></span></label>
        <div className="auth-error" role="alert" aria-live="polite">{error}</div>
        <button className="auth-submit" disabled={loading}>{loading ? <LoaderCircle className="spin" size={15}/> : <LogIn size={15}/>} {loading ? "Signing in…" : "Sign in"}</button>
        <button type="button" className="auth-link" onClick={() => go("forgot")}>Forgot password?</button>
      </form>}

      {mode === "request" && (done ? <div className="auth-done" role="status">{done}</div> : <form onSubmit={submitRequest}>
        <div className="auth-field-row">
          <label className="auth-field"><span>Full name</span><input required value={req.name} maxLength={80} onChange={(e) => setReq({ ...req, name: e.target.value })} autoComplete="name"/></label>
          <label className="auth-field"><span>Company</span><input required value={req.company} maxLength={120} onChange={(e) => setReq({ ...req, company: e.target.value })} autoComplete="organization"/></label>
        </div>
        <div className="auth-field-row">
          <label className="auth-field"><span>Supplier code</span><input required value={req.supplierCode} maxLength={20} onChange={(e) => setReq({ ...req, supplierCode: e.target.value.toUpperCase() })} autoCapitalize="characters"/></label>
          <label className="auth-field"><span>Work email</span><input type="email" required value={req.email} onChange={(e) => setReq({ ...req, email: e.target.value })} autoComplete="email"/></label>
        </div>
        <div className="auth-field-row">
          <label className="auth-field"><span>Password</span><span className="auth-pass"><input type={showPassword ? "text" : "password"} required minLength={10} autoComplete="new-password" value={req.password} onChange={(e) => setReq({ ...req, password: e.target.value })}/>
            <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}>{showPassword ? <EyeOff size={16}/> : <Eye size={16}/>}</button></span></label>
          <label className="auth-field"><span>Repeat password</span><input type={showPassword ? "text" : "password"} required minLength={10} autoComplete="new-password" value={req.password2} onChange={(e) => setReq({ ...req, password2: e.target.value })}/></label>
        </div>
        <input className="auth-hp" tabIndex={-1} aria-hidden="true" autoComplete="off" name="website" value={req.website} onChange={(e) => setReq({ ...req, website: e.target.value })}/>
        <div className="auth-error" role="alert" aria-live="polite">{error}</div>
        <button className="auth-submit" disabled={loading}>{loading ? <LoaderCircle className="spin" size={15}/> : <Send size={15}/>} Submit request</button>
      </form>)}

      {mode === "forgot" && (done ? <div>
        <div className="auth-done" role="status">{done}</div>
        {helpSent ? <div className="auth-done" role="status">An administrator has been notified.</div> : <button type="button" className="auth-link" disabled={loading} onClick={() => void askAdmin()}>No email? Ask an administrator</button>}
        <button type="button" className="auth-link" onClick={() => go("signin")}>Back to sign in</button>
      </div> : <form onSubmit={submitForgot}>
        <label className="auth-field"><span>Email</span><input type="email" required autoFocus autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)}/></label>
        <div className="auth-error" role="alert" aria-live="polite">{error}</div>
        <button className="auth-submit" disabled={loading}>{loading ? <LoaderCircle className="spin" size={15}/> : <Send size={15}/>} Send reset link</button>
        <button type="button" className="auth-link" onClick={() => go("signin")}>Back to sign in</button>
      </form>)}
    </div>
    <p className="auth-foot">Private TMMIN workspace</p>
  </main>;
}
