"use client";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";

/**
 * One confirmation dialog for every irreversible or bulk action (replaces window.confirm).
 * Native <dialog> + showModal(): focus is trapped, Esc cancels, focus returns to the trigger.
 * For large batches the person types the count, so a reflex click cannot apply hundreds of judgements.
 */
export type ConfirmRequest = {
  title: string;
  body?: string;
  /** Short list shown under the body (e.g. the first part numbers). */
  items?: string[];
  confirmLabel: string;
  tone?: "default" | "danger";
  /** When set, the confirm button stays disabled until this exact text is typed. */
  typeToConfirm?: string;
};
type Pending = ConfirmRequest & { resolve: (ok: boolean) => void };

let open: ((r: Pending) => void) | null = null;

/** Ask the person; resolves true only on an explicit confirm. Falls back to window.confirm if no host is mounted. */
export function confirmAction(req: ConfirmRequest): Promise<boolean> {
  if (!open) return Promise.resolve(typeof window !== "undefined" && window.confirm(`${req.title}\n\n${req.body ?? ""}`));
  return new Promise((resolve) => open!({ ...req, resolve }));
}

/** Typed confirmation from this many items on. */
export const TYPE_TO_CONFIRM_FROM = 50;

export function ConfirmHost() {
  const [req, setReq] = useState<Pending | null>(null);
  const [typed, setTyped] = useState("");
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { open = (r) => { setTyped(""); setReq(r); }; return () => { open = null; }; }, []);
  useEffect(() => { const d = ref.current; if (req && d && !d.open) d.showModal(); }, [req]);
  const close = (ok: boolean) => { const r = req; ref.current?.close(); setReq(null); r?.resolve(ok); };
  const blocked = Boolean(req?.typeToConfirm) && typed.trim() !== req?.typeToConfirm;
  return <dialog ref={ref} className={"cfm" + (req?.tone === "danger" ? " danger" : "")} aria-labelledby="cfm-title" aria-describedby="cfm-body"
    onCancel={(e) => { e.preventDefault(); close(false); }}>
    {req && <form method="dialog" onSubmit={(e) => { e.preventDefault(); if (!blocked) close(true); }}>
      <h2 id="cfm-title">{req.tone === "danger" && <AlertTriangle size={18} aria-hidden="true"/>} {req.title}</h2>
      {req.body && <p id="cfm-body" className="cfm-body">{req.body}</p>}
      {req.items && req.items.length > 0 && <ul className="cfm-items">{req.items.map((i) => <li key={i}>{i}</li>)}</ul>}
      {req.typeToConfirm && <label className="cfm-type">Type <b>{req.typeToConfirm}</b> to confirm
        <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} inputMode="numeric" autoComplete="off"/></label>}
      <div className="cfm-actions">
        <button type="button" className="btn" onClick={() => close(false)} autoFocus={!req.typeToConfirm}>Cancel</button>
        <button type="submit" className={"btn " + (req.tone === "danger" ? "btn-danger" : "btn-primary")} disabled={blocked}>{req.confirmLabel}</button>
      </div>
    </form>}
  </dialog>;
}
