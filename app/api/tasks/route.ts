import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ tasks: [], mode: "local-preview" });
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const caseId = request.nextUrl.searchParams.get("caseId");
  let query = supabase.from("verification_tasks").select("id,case_id,task_type,title,description,external_party,status,due_at,created_at").order("created_at", { ascending: false }).limit(100);
  if (caseId) query = query.eq("case_id", caseId);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tasks: data || [] }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Persistent tasks require Supabase." }, { status: 503 });
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (!profile || !["admin", "preparer", "reviewer"].includes(profile.role)) return NextResponse.json({ error: "Preparer, reviewer or admin role is required." }, { status: 403 });
  const body = await request.json().catch(() => null) as { caseId?: string; taskType?: string; title?: string; description?: string; externalParty?: string; dueAt?: string } | null;
  if (!body?.caseId || !/^[0-9a-f-]{36}$/i.test(body.caseId)) return NextResponse.json({ error: "A valid caseId is required." }, { status: 400 });
  if (!body.title?.trim() || body.title.length > 180) return NextResponse.json({ error: "Task title is required (max 180 characters)." }, { status: 400 });
  const { data, error } = await supabase.from("verification_tasks").insert({ case_id: body.caseId, task_type: body.taskType?.slice(0, 60) || "MANUAL_VERIFICATION", title: body.title.trim(), description: body.description?.slice(0, 4000) || null, external_party: body.externalParty?.slice(0, 120) || null, due_at: body.dueAt || null, created_by: auth.user.id }).select("id,case_id,task_type,title,description,status,due_at,created_at").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await supabase.from("audit_events").insert({ actor_id: auth.user.id, action: "VERIFICATION_TASK_CREATED", entity_type: "verification_task", entity_id: data.id, metadata: { caseId: body.caseId, taskType: body.taskType || "MANUAL_VERIFICATION" } });
  return NextResponse.json({ task: data }, { status: 201 });
}
