import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { canAccessImdsTracker } from "@/lib/security/imds-tracker";
import { TrackerWorkbench } from "@/components/tracker/workbench";
export const dynamic="force-dynamic";
export default async function Page(){
  const auth=await getAuthContext();
  if(!auth.userId)redirect("/login?next=%2Ftracker-workbench");
  if(auth.roleError||!canAccessImdsTracker(auth.role))return <main><h1>Tracker access unavailable</h1><p>Contact your administrator.</p></main>;
  return <TrackerWorkbench role={auth.role||"internal"}/>;
}
