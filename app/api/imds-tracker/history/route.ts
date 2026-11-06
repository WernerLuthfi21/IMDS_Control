import { NextResponse } from "next/server";
import { trackerAuth } from "@/lib/imds-tracker/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await trackerAuth(["admin", "preparer", "reviewer", "viewer"]);
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  const [master, mds, followups] = await Promise.all([
    ctx.supabase.from("imds_master_import_batches").select("id,file_name,source_file_hash,source_sheet,total_rows,inserted_rows,updated_rows,skipped_rows,metadata,created_at").order("created_at", { ascending: false }).limit(10),
    ctx.supabase.from("imds_mds_import_batches").select("id,file_name,source_file_hash,source_sheet,total_rows,matched_master_rows,unmatched_part_numbers,metadata,created_at").order("created_at", { ascending: false }).limit(10),
    ctx.supabase.from("imds_tracker_followup_logs").select("id,supplier_code,supplier_name,recipient_email,part_count,attachment_name,status,error_message,sent_at,created_at").order("created_at", { ascending: false }).limit(10)
  ]);
  const error = master.error || mds.error || followups.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ masterImports: master.data || [], mdsImports: mds.data || [], followups: followups.data || [] }, { headers: { "Cache-Control": "private, no-store" } });
}
