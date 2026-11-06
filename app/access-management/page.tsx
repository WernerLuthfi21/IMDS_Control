import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AccessManagement } from "@/components/access-management";

export const dynamic = "force-dynamic";

export default async function AccessManagementPage() {
  const supabase = await createClient();
  if (!supabase) redirect("/setup-required");
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login?next=/access-management");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (profile?.role !== "admin") redirect("/workspace");
  const [{ data: requests }, { data: recipients }] = await Promise.all([
    supabase.from("access_requests").select("id,request_type,requester_name,requester_email,company_name,target_name,target_email,requested_role,supplier_code,note,status,created_at").order("created_at", { ascending: false }).limit(150),
    supabase.from("access_approval_recipients").select("id,email,display_name,active").eq("active", true).order("created_at", { ascending: true })
  ]);
  return <>
    <div className="page-heading"><div><div className="eyebrow">ADMINISTRATION / IDENTITY</div><h1 className="page-title">Access management</h1><div className="page-subtitle">Review account requests, provision approved users and manage approval notifications.</div></div><span className="status status-green">ADMIN ONLY</span></div>
    <AccessManagement initialRequests={(requests || []) as never} initialRecipients={(recipients || []) as never}/>
  </>;
}
