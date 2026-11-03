import { ShieldCheck, LockKeyhole } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ApprovalQueue } from "@/components/approval-queue";
export default async function ApprovalsPage() {
  const supabase=await createClient(); let runs: any[]=[]; let signedIn=false;
  if(supabase){const {data:auth}=await supabase.auth.getUser();signedIn=!!auth.user;if(auth.user){const {data}=await supabase.from("judgement_runs").select("id,error_type_label,rule_id,rule_status,recommendation,final_decision,reason,created_at,source_references").order("created_at",{ascending:false}).limit(50);runs=data||[];}}
  return <><div className="page-heading"><div><div className="eyebrow">GOVERNANCE / REVIEW CONTROL</div><h1 className="page-title">Final Approvals</h1><div className="page-subtitle">Human review queue for saved judgement runs. Final actions are enforced inside PostgreSQL.</div></div><span className="status status-amber"><LockKeyhole size={12}/> ROLE GATED</span></div>{!signedIn&&<div className="notice-strip">Sign in to view persisted judgement runs and approve eligible records. Local preview evaluation is not persisted.</div>}<div className="notice-strip"><ShieldCheck size={15}/><span>Only recommendation-matched decisions can be finalized. Rule status must be APPROVED or ACTIVE. HOLD, MANUAL REVIEW and DRAFT rules are not finalizable.</span></div><ApprovalQueue runs={runs}/></>;
}
