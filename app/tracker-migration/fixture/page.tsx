import { notFound } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { TrackerFoundation } from "@/components/tracker/tracker-foundation";
export const dynamic="force-dynamic";
/** Dev-only visual fixture; never an authentication bypass or a production endpoint. */
export default async function TrackerFixture(){
 if(process.env.NODE_ENV!=="development"||process.env.TRACKER_TEST_FIXTURE!=="1")notFound();
 const auth=await getAuthContext();if(auth.configured)notFound();
 return <TrackerFoundation fixture/>;
}
