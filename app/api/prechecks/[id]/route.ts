import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const allowed = ["INTERNAL_REVIEW", "NEED_SUPPLIER_ACTION", "CLEARED_FOR_IMDS", "REJECTED"] as const;
type ReviewStatus = typeof allowed[number];

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid pre-check id." }, { status: 400 });
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (!profile || !["admin", "preparer", "reviewer"].includes(profile.role)) {
    return NextResponse.json({ error: "Internal preparer/reviewer role required." }, { status: 403 });
  }
  const body = await request.json().catch(() => null) as { status?: string; comment?: string; sourceVerifiedByHuman?: boolean } | null;
  if (!body || !allowed.includes(body.status as ReviewStatus)) return NextResponse.json({ error: "A valid review status is required." }, { status: 400 });
  const status = body.status as ReviewStatus;
  const comment = String(body.comment || "").trim();
  if (["NEED_SUPPLIER_ACTION", "CLEARED_FOR_IMDS", "REJECTED"].includes(status) && comment.length < 8) {
    return NextResponse.json({ error: "Please enter a clear review note (at least 8 characters)." }, { status: 422 });
  }
  if (status === "CLEARED_FOR_IMDS" && profile.role !== "admin" && profile.role !== "reviewer") {
    return NextResponse.json({ error: "Only TMA reviewer or admin can clear a supplier pre-check." }, { status: 403 });
  }
  const { data: before, error: readError } = await supabase.from("supplier_prechecks")
    .select("id,supplier_code,delivery_part_no,mds_id,mds_version,mds_status,preliminary_mds,workflow_status")
    .eq("id", id).single();
  if (readError || !before) return NextResponse.json({ error: readError?.message || "Pre-check not found." }, { status: 404 });
  const { data, error } = await supabase.from("supplier_prechecks").update({
    workflow_status: status,
    review_comment: comment || null,
    source_verified_by_human: status === "CLEARED_FOR_IMDS" ? body.sourceVerifiedByHuman === true : false,
    reviewed_by: auth.user.id,
    reviewed_at: new Date().toISOString()
  }).eq("id", id).select("id,supplier_code,delivery_part_no,workflow_status,review_comment,reviewed_at,source_verified_by_human").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 409 });
  await supabase.from("audit_events").insert({ actor_id: auth.user.id, action: "SUPPLIER_PRECHECK_REVIEWED", entity_type: "supplier_precheck", entity_id: id, metadata: { status, supplierCode: before.supplier_code, partNo: before.delivery_part_no } });
  return NextResponse.json({ submission: data });
}
