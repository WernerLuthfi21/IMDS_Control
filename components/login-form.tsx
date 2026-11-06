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
  const [notice, setNotice] = useState("");
  const [request, setRequest] = useState({ fullName: "", company: "", email: "", supplierCode: "", note: "" });
  const [mfa, setMfa] = useState<{ factorId: string; challengeId: string } | null>(null);
  const [mfaCode, setMfaCode] = useState("");

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
    const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assurance?.nextLevel === "aal2" && assurance.currentLevel !== "aal2") {
      const { data: factors, error: factorError } = await supabase.auth.mfa.listFactors();
      const factor = factors?.totp?.find((item) => item.status === "verified");
      if (factorError || !factor) { await supabase.auth.signOut(); setError("Authenticator verification is required but no verified factor is available. Contact the administrator."); setLoading(false); return; }
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: factor.id });
      if (challengeError || !challenge) { await supabase.auth.signOut(); setError("Could not start authenticator verification. Please try again."); setLoading(false); return; }
      setMfa({ factorId: factor.id, challengeId: challenge.id }); setLoading(false); return;
    }
    window.location.assign(next);
  }

  async function verifyAuthenticator(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError("");
    const supabase = createClient();
    if (!supabase || !mfa) { setError("Authenticator verification has expired. Sign in again."); setLoading(false); return; }
    const { error: verifyError } = await supabase.auth.mfa.verify({ factorId: mfa.factorId, challengeId: mfa.challengeId, code: mfaCode.replace(/\s/g, "") });
    if (verifyError) { setError("The authenticator code is incorrect or expired."); setLoading(false); return; }
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

      {mode === "signin" ? mfa ? <form onSubmit={verifyAuthenticator}>
        <div className="auth-mfa-prompt"><strong>Verify your identity</strong><span>Enter the current 6-digit code from your authenticator app.</span></div>
        <label className="auth-field"><span>Authenticator code</span><input required autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} /></label>
        {error && <div className="auth-error" role="alert">{error}</div>}
        <button className="auth-submit" disabled={loading || mfaCode.trim().length < 6}>{loading ? <LoaderCircle className="spin" size={16} /> : <LogIn size={16} />} {loading ? "Verifying…" : "Verify and continue"}</button>
        <button type="button" className="auth-cancel-mfa" onClick={async () => { const supabase = createClient(); await supabase?.auth.signOut(); setMfa(null); setMfaCode(""); setPassword(""); setError(""); }}>Cancel sign in</button>
      </form> : <form onSubmit={signIn}>
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
        <p>Your supplier access request is now in the administrator review queue.</p>{notice && <p className="auth-request-warning">{notice}</p>}
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
