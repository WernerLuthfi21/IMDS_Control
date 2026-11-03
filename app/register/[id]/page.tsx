import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RegisterEditor } from "@/components/register-editor";
export const dynamic = "force-dynamic";
export default async function RegisterItemPage({params}:{params:Promise<{id:string}>}){
 const {id}=await params;const supabase=await createClient();if(!supabase) redirect("/setup-required");
 const {data:auth}=await supabase.auth.getUser();if(!auth.user)redirect("/login");
 const {data:profile}=await supabase.from("profiles").select("role").eq("id",auth.user.id).maybeSingle();
 if(profile?.role==="supplier") redirect("/supplier-precheck");
 const {data,error}=await supabase.from("gcat_error_items").select("id,source_record_key,error_type_label,delivery_part_no,supplier_code,cas_no,substance_name,source_status,assigned_person,starting_date,judgement_procedure,judge,ok_comment,imds_reject_comment,km_judge,km_comment,last_change_date,source_judge_label,source_km_judge_label,case_id").eq("id",id).maybeSingle();
 if(error||!data) notFound();return <RegisterEditor item={data as any} role={profile?.role||"viewer"}/>;
}
