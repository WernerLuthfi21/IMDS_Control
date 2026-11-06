"use client";
import { useEffect, useState } from "react";
import { Check, KeyRound, LoaderCircle, ShieldCheck, Smartphone } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type TotpFactor = { id: string; status: string; friendly_name?: string | null };
export function AccountSecurity() {
  const [supabase] = useState(() => createClient());
  const [factors, setFactors] = useState<TotpFactor[]>([]);
  const [setup, setSetup] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  async function refreshFactors() {
    if (!supabase) return;
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors((data?.totp || []) as TotpFactor[]);
  }
  useEffect(() => { void refreshFactors(); }, []);
  const verified = factors.filter((factor) => factor.status === "verified");

  async function changePassword(e: React.FormEvent) {
    e.preventDefault(); setError(""); setMessage("");
    if (!supabase) return;
    if (password.length < 12) { setError("Use at least 12 characters."); return; }
    if (password !== confirm) { setError("The passwords do not match."); return; }
    setBusy(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) setError("Password change failed. Sign in again and retry.");
    else { setMessage("Password changed successfully."); setPassword(""); setConfirm(""); }
    setBusy(false);
  }

  async function beginMfa() {
    if (!supabase) return;
    setBusy(true); setError(""); setMessage("");
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "IMDS Workspace" });
    if (enrollError || !data?.totp) setError(enrollError?.message || "Could not start authenticator setup.");
    else setSetup({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    setBusy(false);
  }

  async function verifyMfa(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || !setup) return;
    setBusy(true); setError(""); setMessage("");
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: setup.id });
    if (challengeError || !challenge) { setError("Could not verify the authenticator challenge."); setBusy(false); return; }
    const { error: verifyError } = await supabase.auth.mfa.verify({ factorId: setup.id, challengeId: challenge.id, code: code.replace(/\s/g, "") });
    if (verifyError) setError("The authenticator code is invalid or expired.");
    else { setSetup(null); setCode(""); setMessage("Authenticator verification is enabled for this account."); await refreshFactors(); }
    setBusy(false);
  }

  async function removeMfa(id: string) {
    if (!supabase) return;
    setBusy(true); setError(""); setMessage("");
    const { error: removeError } = await supabase.auth.mfa.unenroll({ factorId: id });
    if (removeError) setError("Could not remove this authenticator. Complete MFA verification and retry.");
    else { setMessage("Authenticator removed."); await refreshFactors(); }
    setBusy(false);
  }

  return <section className="panel account-security">
    <div className="panel-header"><div><div className="panel-title">Account security</div><div className="panel-subtitle">Manage your password and authenticator-based sign-in verification.</div></div><ShieldCheck size={17}/></div>
    <div className="panel-body">
      {message && <div className="callout callout-success" role="status">{message}</div>}
      {error && <div className="callout callout-danger" role="alert">{error}</div>}
      <div className="security-block">
        <div className="security-block-head"><KeyRound size={16}/><div><strong>Change password</strong><span>Use at least 12 characters. Your current session stays signed in.</span></div></div>
        <form className="security-password-form" onSubmit={changePassword}>
          <label className="form-field"><span>New password</span><input className="field" type="password" minLength={12} autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)}/></label>
          <label className="form-field"><span>Confirm password</span><input className="field" type="password" minLength={12} autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)}/></label>
          <button type="submit" className="btn btn-primary" disabled={busy}><Check size={14}/> Update password</button>
        </form>
      </div>
      <div className="security-block">
        <div className="security-block-head"><Smartphone size={16}/><div><strong>Authenticator app</strong><span>Use an authenticator such as Microsoft Authenticator, Google Authenticator or a compatible TOTP app.</span></div></div>
        {verified.length ? verified.map((factor) => <div className="security-factor" key={factor.id}><span><Check size={14}/> {factor.friendly_name || "TOTP authenticator"} · Active</span><button type="button" className="btn btn-sm btn-secondary" disabled={busy} onClick={() => void removeMfa(factor.id)}>Remove</button></div>) : !setup ? <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void beginMfa()}>{busy ? <LoaderCircle size={14} className="spin"/> : <Smartphone size={14}/>} Set up authenticator</button> : <form onSubmit={verifyMfa} className="mfa-setup">
          <p>Scan this QR code with your authenticator app. You can enter the setup key manually if scanning is unavailable.</p>
          {setup.qr && <img className="mfa-qr" src={setup.qr} alt="Authenticator setup QR code"/>}
          <div className="mfa-secret"><span>Manual setup key</span><code>{setup.secret}</code></div>
          <label className="form-field"><span>6-digit verification code</span><input className="field" inputMode="numeric" autoComplete="one-time-code" maxLength={8} required value={code} onChange={(e) => setCode(e.target.value)}/></label>
          <div className="mfa-actions"><button className="btn btn-primary" type="submit" disabled={busy || code.trim().length < 6}>{busy ? <LoaderCircle size={14} className="spin"/> : <Check size={14}/>} Verify and enable</button><button className="btn btn-secondary" type="button" onClick={() => setSetup(null)}>Cancel</button></div>
        </form>}
      </div>
    </div>
  </section>;
}
