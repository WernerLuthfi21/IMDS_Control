"use client";
import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

/** Any page that throws lands here instead of a blank screen. Nothing was saved by the failed render. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return <section className="state-page" role="alert">
    <span className="state-icon err" aria-hidden="true"><AlertTriangle size={22}/></span>
    <h1>This page could not be shown</h1>
    <p>Something failed while loading it. Your saved judgements are not affected; nothing was written by this error.</p>
    {error.digest && <p className="state-ref">Reference for the administrator: <code>{error.digest}</code></p>}
    <div className="state-actions"><button type="button" className="btn btn-primary" onClick={reset}><RotateCcw size={14}/> Try again</button><Link className="btn" href="/judgement">Go to the Judgement register</Link></div>
  </section>;
}
