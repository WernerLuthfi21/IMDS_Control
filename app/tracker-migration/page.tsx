import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { canAccessImdsTracker } from "@/lib/security/imds-tracker";
import { TrackerFoundation } from "@/components/tracker/tracker-foundation";
export const dynamic="force-dynamic";
export default async function TrackerMigrationPage(){
 const auth=await getAuthContext();
 if(!auth.configured)return <p>Tracker migration is unavailable until authentication is configured.</p>;
 if(!auth.userId)redirect("/login?next=%2Ftracker-migration");
 if(auth.roleError||!canAccessImdsTracker(auth.role))return <p>Internal workspace access required.</p>;
 return <TrackerFoundation/>;
}
