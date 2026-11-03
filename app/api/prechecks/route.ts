import { NextRequest,NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
export async function POST(request:NextRequest){
 const supabase=await createClient();if(!supabase)return NextResponse.json({error:"Persistent supplier pre-check requires Supabase."},{status:503});
 const {data:auth}=await supabase.auth.getUser();if(!auth.user)return NextResponse.json({error:"Authentication required."},{status:401});
 const {data:profile}=await supabase.from("profiles").select("role,supplier_code").eq("id",auth.user.id).maybeSingle();if(!profile||!["supplier","admin","preparer"].includes(profile.role))return NextResponse.json({error:"Supplier or internal preparer role required."},{status:403});
 const body=await request.json().catch(()=>null) as Record<string,unknown>|null;if(!body)return NextResponse.json({error:"Invalid request."},{status:400});
 const supplierCode=String(body.supplierCode||profile.supplier_code||"").trim();const partNo=String(body.deliveryPartNo||"").trim();
 if(!supplierCode||!partNo)return NextResponse.json({error:"Supplier Code and Delivery Part No are required."},{status:422});
 if(profile.role==="supplier"&&supplierCode!==profile.supplier_code)return NextResponse.json({error:"Supplier account can only submit for its assigned supplier code."},{status:403});
 const path=typeof body.attachmentPath==="string"?body.attachmentPath:null;
 if(path&&!path.startsWith(`${auth.user.id}/`))return NextResponse.json({error:"Attachment is outside your private upload folder."},{status:403});
 if(path){const {data:object,error:objectError}=await supabase.storage.from("supplier-precheck-private").createSignedUrl(path,60);if(objectError||!object?.signedUrl)return NextResponse.json({error:"Uploaded supplier attachment could not be verified in private storage."},{status:404});}
 const attachmentName=typeof body.attachmentName==="string"?body.attachmentName:null;
 const ext=attachmentName?.split(".").pop()?.toLowerCase();
 const sourceFormat=ext==="pdf"?"MDS_REPORT_PDF_ATTACHMENT":ext==="xlsx"?"XLSX":ext==="csv"?"CSV":"MANUAL";
 // This workflow deliberately does not parse MDS Report PDFs. The supplied report includes a no-parsing notice.
 const checks=[
  {key:"supplier_code",label:"Supplier Code provided",result:"PASS"},
  {key:"delivery_part_no",label:"Delivery Part No provided",result:"PASS"},
  {key:"mds_id",label:"IMDS ID / Version",result:body.mdsId&&body.mdsVersion?"PROVIDED":"MANUAL_REVIEW"},
  {key:"mds_status",label:"MDS status",result:String(body.mdsStatus||"").toLowerCase().includes("internally released")?"PASS":"MANUAL_REVIEW"},
  {key:"preliminary_mds",label:"Final / non-preliminary MDS",result:body.preliminaryMds===false?"PASS":"MANUAL_REVIEW"},
  {key:"attachment",label:"Attachment review",result:sourceFormat==="MDS_REPORT_PDF_ATTACHMENT"?"MANUAL_REVIEW":"ATTACHED_NOT_PARSED"}
 ];
 const {data,error}=await supabase.from("supplier_prechecks").insert({supplier_code:supplierCode,supplier_name:String(body.supplierName||"").trim()||null,delivery_part_no:partNo,delivery_part_name:String(body.deliveryPartName||"").trim()||null,mds_id:String(body.mdsId||"").trim()||null,mds_version:String(body.mdsVersion||"").trim()||null,mds_status:String(body.mdsStatus||"").trim()||null,preliminary_mds:body.preliminaryMds===true?true:body.preliminaryMds===false?false:null,source_format:sourceFormat,attachment_path:path,attachment_name:attachmentName,submitted_by:auth.user.id,workflow_status:"SUBMITTED",check_results:checks,extracted_fields:typeof body.extractedFields==="object"&&body.extractedFields!==null?body.extractedFields:{},extraction_warnings:Array.isArray(body.extractionWarnings)?body.extractionWarnings:[],notes:String(body.notes||"").slice(0,4000)||null}).select("id,workflow_status,created_at,check_results").single();
 if(error)return NextResponse.json({error:error.message},{status:400});
 await supabase.from("audit_events").insert({actor_id:auth.user.id,action:"SUPPLIER_PRECHECK_SUBMITTED",entity_type:"supplier_precheck",entity_id:data.id,metadata:{supplierCode,deliveryPartNo:partNo,sourceFormat}});
 return NextResponse.json({submission:data}, {status:201});
}
export async function GET(){
 const supabase=await createClient();if(!supabase)return NextResponse.json({submissions:[],mode:"local-preview"});
 const {data:auth}=await supabase.auth.getUser();if(!auth.user)return NextResponse.json({error:"Authentication required."},{status:401});
 const {data,error}=await supabase.from("supplier_prechecks").select("id,supplier_code,supplier_name,delivery_part_no,mds_id,mds_version,mds_status,workflow_status,check_results,extracted_fields,extraction_warnings,review_comment,reviewed_at,source_verified_by_human,attachment_path,attachment_name,created_at").order("created_at",{ascending:false}).limit(50);
 if(error)return NextResponse.json({error:error.message},{status:500});return NextResponse.json({submissions:data||[]});
}
