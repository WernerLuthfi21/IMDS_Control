"use client";
import { useState } from "react";
import { Eye, EyeOff, LoaderCircle, LogIn, UserRoundPlus, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Mode = "signin" | "supplier";

export function LoginForm({ next }: { next: string }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [request, setRequest] = useState({ fullName: "", company: "", email: "", supplierCode: "", note: "" });

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const supabase = createClient();
    if (!supabase) { setError("Sign-in is not available. Contact the administrator."); setLoading(false); return; }
    const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (authError) {
      setError("Email or password is incorrect. You can reset your password and try again.");
      setLoading(false);
      return;
    }
    window.location.assign(next);
  }

  async function submitSupplierRequest(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const response = await fetch("/api/access-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(data.error || "The request could not be submitted.");
      setLoading(false);
      return;
    }
    setSubmitted(true);
    setLoading(false);
  }

  const changeMode = (value: Mode) => {
    setMode(value);
    setError("");
    setSubmitted(false);
  };

  return <main className="auth-page">
    <section className="auth-card">
      <div className="auth-brand"><span className="auth-brand-mark">IM</span><span>TMMIN <i>·</i> IMDS WORKSPACE</span></div>
      <h1>{mode === "signin" ? "Welcome back" : "Supplier access"}</h1>
      <div className="auth-tabs" role="tablist" aria-label="Account access">
        <button type="button" role="tab" aria-selected={mode === "signin"} className={mode === "signin" ? "on" : ""} onClick={() => changeMode("signin")}>Sign in</button>
        <button type="button" role="tab" aria-selected={mode === "supplier"} className={mode === "supplier" ? "on" : ""} onClick={() => changeMode("supplier")}>Request access</button>
      </div>

      {mode === "signin" ? <form onSubmit={signIn}>
        <label className="auth-field"><span>Work email</span>
          <input type="email" required autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" /></label>
        <label className="auth-field"><span>Password</span>
          <span className="auth-pass"><input type={showPassword ? "text" : "password"} required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" />
            <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
        <div className="auth-row-links"><a href="/forgot-password">Forgot password?</a></div>
        {error && <div className="auth-error" role="alert">{error}</div>}
        <button className="auth-submit" disabled={loading}>{loading ? <LoaderCircle className="spin" size={16} /> : <LogIn size={16} />} {loading ? "Signing in…" : "Sign in"}</button>
      </form> : submitted ? <div className="auth-success" role="status">
        <CheckCircle2 size={25} />
        <strong>Request submitted</strong>
        <p>Your supplier access request is now in the administrator review queue.</p>
        <button type="button" className="auth-submit auth-secondary" onClick={() => { setMode("signin"); setSubmitted(false); }}>Back to sign in</button>
      </div> : <form onSubmit={submitSupplierRequest}>
        <div className="auth-field-grid">
          <label className="auth-field"><span>Full name</span><input required maxLength={100} autoComplete="name" value={request.fullName} onChange={(e) => setRequest({ ...request, fullName: e.target.value })} /></label>
          <label className="auth-field"><span>Company</span><input required maxLength={120} autoComplete="organization" value={request.company} onChange={(e) => setRequest({ ...request, company: e.target.value })} /></label>
        </div>
        <label className="auth-field"><span>Work email</span><input required type="email" maxLength={254} autoComplete="email" value={request.email} onChange={(e) => setRequest({ ...request, email: e.target.value })} /></label>
        <label className="auth-field"><span>Supplier code <small>Optional</small></span><input maxLength={20} value={request.supplierCode} onChange={(e) => setRequest({ ...request, supplierCode: e.target.value.toUpperCase() })} /></label>
        <label className="auth-field"><span>Note <small>Optional</small></span><textarea rows={2} maxLength={1000} value={request.note} onChange={(e) => setRequest({ ...request, note: e.target.value })} /></label>
        {error && <div className="auth-error" role="alert">{error}</div>}
        <button className="auth-submit" disabled={loading}>{loading ? <LoaderCircle className="spin" size={16} /> : <UserRoundPlus size={16} />} {loading ? "Submitting…" : "Submit supplier request"}</button>
      </form>}
    </section>
    <p className="auth-foot">Private TMMIN workspace</p>
  </main>;
}
