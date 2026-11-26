import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { canAccessImdsTracker } from "@/lib/security/imds-tracker";
import { toWorkbenchRows, communicationState, type WorkbenchPart } from "@/lib/imds-master/workbench";
import type { DueDates } from "@/lib/followup/render";

export const dynamic="force-dynamic";
const noStore={"Cache-Control":"private, no-store"};
export async function GET(){
  const auth=await getAuthContext();
  if(!auth.configured||auth.roleError)return NextResponse.json({error:"Workspace unavailable."},{status:503,headers:noStore});
  if(!auth.userId)return NextResponse.json({error:"Authentication required."},{status:401,headers:noStore});
  if(!canAccessImdsTracker(auth.role))return NextResponse.json({error:"Internal workspace access required."},{status:403,headers:noStore});
  const db=await createClient();
  if(!db)return NextResponse.json({error:"Workspace unavailable."},{status:503,headers:noStore});
  const [head,due,history]=await Promise.all([
    db.from("imds_master_parts").select("id",{count:"exact",head:true}),
    db.from("imds_tracker_settings").select("value").eq("key","due_dates").maybeSingle(),
    db.from("imds_tracker_followup_logs").select("id,created_at,status,part_count,provider_response").order("created_at",{ascending:false}).limit(50)
  ]);
  if(head.error||due.error||head.count===null||head.count>60000)return NextResponse.json({error:"Shared master or deadline settings unavailable or exceeds snapshot limit."},{status:503,headers:noStore});
  const parts:WorkbenchPart[]=[];
  for(let i=0;i<head.count;i+=1000){
    const q=await db.from("imds_master_parts").select("id,company_name,vendor_code,project,part_no,imds_status,submission_plan,supplier_promise_date,main_pic_email").order("id").range(i,i+999);
    if(q.error)return NextResponse.json({error:"Snapshot could not be loaded."},{status:503,headers:noStore});
    parts.push(...((q.data||[]) as WorkbenchPart[]));
  }
  if(parts.length!==head.count)return NextResponse.json({error:"Master changed during read. Refresh and try again."},{status:409,headers:noStore});
  const now=new Date(),today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Jakarta"}).format(now);
  return NextResponse.json({rows:toWorkbenchRows(parts,(due.data?.value||{}) as DueDates,today),refreshedAt:now.toISOString(),historyAvailable:!history.error,events:(history.data||[]).map(r=>({id:r.id,time:r.created_at,state:communicationState(r.status,r.provider_response),parts:r.part_count})),readiness:{scheduler:!!process.env.CRON_SECRET,flow:!!process.env.POWER_AUTOMATE_EMAIL_URL&&!!process.env.POWER_AUTOMATE_SECRET}},{headers:noStore});
}
