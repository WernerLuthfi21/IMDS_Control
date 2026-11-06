import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { StaffAccessRequest } from "@/components/staff-access-request";

export const dynamic = "force-dynamic";
export default async function TeamAccessRequestPage() {
  const auth = await getAuthContext();
  if (!auth.userId) redirect("/login?next=/team-access-request");
  if (!auth.role || auth.role === "supplier") redirect("/supplier-precheck");
  return <>
    <div className="page-heading"><div><div className="eyebrow">INTERNAL WORKSPACE / PEOPLE</div><h1 className="page-title">Request a TMMIN account</h1><div className="page-subtitle">Nominate a TMMIN colleague. Account creation stays subject to Admin approval.</div></div></div>
    <StaffAccessRequest requesterEmail={auth.email || ""}/>
  </>;
}
