import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Approval requires a configured Supabase project." }, { status: 503 });
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const body = await request.json().catch(() => null) as { judgementRunId?: string; decision?: string; comment?: string } | null;
  if (!body?.judgementRunId || !/^[0-9a-f-]{36}$/i.test(body.judgementRunId)) return NextResponse.json({ error: "A valid judgementRunId is required." }, { status: 400 });
  if (body.decision !== "FINAL_OK" && body.decision !== "FINAL_NG") return NextResponse.json({ error: "decision must be FINAL_OK or FINAL_NG." }, { status: 400 });
  const comment = body.comment?.trim();
  if (!comment || comment.length < 8 || comment.length > 2000) return NextResponse.json({ error: "A reviewer comment of 8–2,000 characters is required." }, { status: 400 });
  const { data, error } = await supabase.rpc("approve_judgement", { p_run_id: body.judgementRunId, p_decision: body.decision, p_comment: comment });
  if (error) return NextResponse.json({ error: error.message }, { status: 409 });
  return NextResponse.json({ approval: data });
}
