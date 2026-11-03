import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, Boxes, ClipboardCheck, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { canAccessImdsTracker } from "@/lib/security/imds-tracker";
export const dynamic = "force-dynamic";
export default async function WorkspacePage() {
  const supabase = await createClient();
  if (!supabase) redirect("/setup-required");
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login?next=%2Fworkspace");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (!canAccessImdsTracker(profile?.role)) redirect(profile?.role === "supplier" ? "/supplier-precheck" : "/login");
  return <main className="workspace-page">
    <div className="workspace-eyebrow"><Sparkles size={14}/> TMMIN · IMDS WORKSPACE</div>
    <header className="workspace-intro"><div>
      <h1>Good to see you.<br/><span>Where would you like to work?</span></h1>
      <p>Choose one workspace to continue. Each keeps its own tools, visual identity and workflow.</p>
    </div></header>
    <section className="workspace-grid" aria-label="Choose your workspace">
      <Link href="/imds-tracker" className="workspace-card workspace-card-tracker">
        <div><div className="workspace-card-top"><span className="workspace-card-kicker">01 · TRACKING &amp; FOLLOW-UP</span><span className="workspace-card-icon tracker-icon"><Boxes size={24}/></span></div>
          <h2>IMDS Tracker</h2><p>Track model and supplier progress, outstanding parts, follow-ups and reporting.</p></div>
        <div className="workspace-card-action tracker-action"><strong>Enter Tracker</strong><span><ArrowUpRight size={17}/></span></div>
      </Link>
      <Link href="/judgement" className="workspace-card workspace-card-judgement">
        <div><div className="workspace-card-top"><span className="workspace-card-kicker">02 · G-CATS EVALUATION</span><span className="workspace-card-icon judgement-icon"><ClipboardCheck size={24}/></span></div>
          <h2>IMDS Judgement</h2><p>Review active G-CATS errors, run guided checks and record judgement outcomes.</p></div>
        <div className="workspace-card-action judgement-action"><strong>Enter Judgement</strong><span><ArrowUpRight size={17}/></span></div>
      </Link>
    </section>
    <p className="workspace-footnote">Private TMMIN workspace · Access follows your account role</p>
  </main>;
}