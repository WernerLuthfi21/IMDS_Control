import { createClient } from "@/lib/supabase/server";
import { SupplierPrecheck } from "@/components/supplier-precheck";
import { SupplierSelfCheck } from "@/components/supplier-selfcheck";
import { SupplierMassToleranceSelfCheck } from "@/components/supplier-mass-tolerance-selfcheck";
import { PrecheckTabs } from "@/components/precheck-tabs";
export const dynamic="force-dynamic";
export default async function SupplierPrecheckPage(){const supabase=await createClient();let role="viewer",supplierCode:string|null=null;if(supabase){const {data:auth}=await supabase.auth.getUser();if(auth.user){const {data}=await supabase.from("profiles").select("role,supplier_code").eq("id",auth.user.id).maybeSingle();role=data?.role||"viewer";supplierCode=data?.supplier_code||null;}}return <><div className="page-heading"><div><div className="eyebrow">SUPPLIER / BEFORE IMDS SUBMISSION</div><h1 className="page-title">{role==="supplier"?"Supplier Portal":"Supplier Pre-check"}</h1><p className="page-subtitle">Check submission readiness and receive follow-up requests before / after G-CATS review.</p></div><span className="quiet-badge">PRE-SUBMISSION</span></div><PrecheckTabs tabs={[
  {id:"file",label:"Check a file",hint:"Drop or paste the IMDS data",content:<SupplierSelfCheck role={role} supplierCode={supplierCode}/>},
  ...(role==="supplier"?[{id:"mass",label:"Mass tolerance",hint:"Drawing vs IMDS mass",content:<SupplierMassToleranceSelfCheck supplierCode={supplierCode}/>}]:[]),
  {id:"form",label:"One part by hand",hint:"Enter the values once",content:<SupplierPrecheck role={role} supplierCode={supplierCode}/>}
 ]}/></>}
