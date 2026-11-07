import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { canAccessImdsTracker } from "@/lib/security/imds-tracker";
import { ImdsMasterWorkspace } from "@/components/imds-master-workspace";

export const dynamic = "force-dynamic";

export default async function ImdsMasterPage() {
  const auth = await getAuthContext();
  if (!auth.configured) return <main className="page-shell"><h1>IMDS Master Data</h1><p>Connect Supabase before using the shared master.</p></main>;
  if (!auth.userId) redirect("/login?next=%2Fimds-tracker%2Fmaster");
  if (auth.roleError) return <main className="page-shell"><h1>IMDS Master Data</h1><p>Unable to verify workspace permissions. Please retry.</p></main>;
  if (!canAccessImdsTracker(auth.role)) return <main className="page-shell"><h1>Access restricted</h1><p>Internal workspace access is required.</p></main>;

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">IMDS TRACKER / SHARED SOURCE OF TRUTH</div>
          <h1 className="page-title">IMDS Super Master</h1>
          <p className="page-subtitle">One shared part list, with separate MD System status history and protected manual fields.</p>
        </div>
        <a className="btn btn-secondary" href="/imds-tracker">← Back to Tracker</a>
      </div>
      <ImdsMasterWorkspace canEdit={["admin", "preparer", "reviewer"].includes(auth.role || "")} />
    </>
  );
}
