import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Boxes, ClipboardCheck, LockKeyhole, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { canAccessImdsTracker } from "@/lib/security/imds-tracker";

export const dynamic = "force-dynamic";

export default async function WorkspacePage() {
  const supabase = await createClient();
  if (!supabase) redirect("/setup-required");
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login?next=%2Fworkspace");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (!canAccessImdsTracker(profile?.role)) redirect(profile?.role === "supplier" ? "/supplier-precheck" : "/");

  return <div className="workspace-page">
    <div className="workspace-eyebrow"><span /> IMDS / G-CATS · OPERATIONS</div>
    <header className="workspace-intro">
      <div><h1>One control center.<br /><span>Two focused workflows.</span></h1></div>
      <p>Choose the workspace for your next task. Keep supplier submission tracking separate from internal judgement, review and approval.</p>
    </header>
    <div className="workspace-section-label">SELECT A WORKSPACE</div>
    <section className="workspace-grid" aria-label="Available IMDS workspaces">
      <Link href="/imds-tracker" className="workspace-card workspace-card-tracker">
        <div className="workspace-card-main">
          <div className="workspace-card-top"><span className="workspace-card-kicker">01 / TRACKING &amp; FOLLOW-UP</span><span className="workspace-card-icon"><Boxes size={25} strokeWidth={1.7} /></span></div>
          <h2>IMDS Tracker</h2>
          <p>Monitor part submission progress across models and suppliers. Manage outstanding items, supplier contacts, follow-ups and reporting in one place.</p>
          <div className="workspace-tags"><span>Model progress</span><span>Supplier status</span><span>Follow-up &amp; reports</span></div>
        </div>
        <div className="workspace-card-action"><strong>Open IMDS Tracker</strong><span><ArrowRight size={17} /></span></div>
      </Link>
      <Link href="/" className="workspace-card workspace-card-judgement">
        <div className="workspace-card-main">
          <div className="workspace-card-top"><span className="workspace-card-kicker">02 / INTERNAL EVALUATION</span><span className="workspace-card-icon"><ClipboardCheck size={25} strokeWidth={1.7} /></span></div>
          <h2>IMDS Judgement</h2>
          <p>Continue to the existing G-CATS Judgement Register for source-linked evaluation, documented decisions, internal review and controlled approval.</p>
          <div className="workspace-tags"><span>Judgement register</span><span>Review workflow</span><span>Approval control</span></div>
        </div>
        <div className="workspace-card-action"><strong>Open IMDS Judgement</strong><span><ArrowRight size={17} /></span></div>
      </Link>
    </section>
    <section className="workspace-assurance" aria-label="Security and data notes">
      <div className="workspace-assurance-item"><span><LockKeyhole size={16} /></span><div><strong>Internal access remains protected</strong><p>Both workspaces require an authenticated internal account. Supplier accounts remain in the supplier portal.</p></div></div>
      <div className="workspace-assurance-item"><span><ShieldCheck size={16} /></span><div><strong>Existing judgement safeguards stay intact</strong><p>Judgement, database permissions, audit history and human approval remain in the existing application.</p></div></div>
    </section>
  </div>;
}
