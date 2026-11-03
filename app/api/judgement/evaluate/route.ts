import { NextRequest, NextResponse } from "next/server";
import { evaluateJudgement, type JudgementInput } from "@/lib/judgement/engine";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Judgement input must be an object." }, { status: 400 });
  const input = body as Record<string, unknown>;
  if (!(typeof input.errorType === "string" || typeof input.errorType === "number")) return NextResponse.json({ error: "errorType is required." }, { status: 400 });
  if (JSON.stringify(input).length > 30_000) return NextResponse.json({ error: "Input payload is too large." }, { status: 413 });
  try {
    const supabase = await createClient();
    if (process.env.NODE_ENV === "production" && !supabase) return NextResponse.json({ error: "Production judgement access is disabled until Supabase authentication is configured." }, { status: 503 });
    const dryRun = input.dryRun === true;
    let actorId: string | null = null;
    if (supabase) {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
      const { data: profile } = await supabase.from("profiles").select("role,supplier_code").eq("id", auth.user.id).maybeSingle();
      if (!profile) return NextResponse.json({ error: "Profile not found." }, { status: 403 });
      if (profile.role === "supplier") {
        const isType7 = String(input.errorType).trim().toLowerCase() === "7" || String(input.errorType).trim().toLowerCase() === "mass tolerance range";
        if (!dryRun || !isType7 || typeof input.caseId === "string") {
          return NextResponse.json({ error: "Supplier accounts may only run a non-persistent Type 7 self-check. Internal case judgement is not accessible." }, { status: 403 });
        }
      } else if (!["admin", "preparer", "reviewer"].includes(profile.role)) {
        return NextResponse.json({ error: "Preparer, reviewer or admin role is required to run an internal judgement." }, { status: 403 });
      } else {
        actorId = auth.user.id;
      }
    }
    const result = evaluateJudgement(input as unknown as JudgementInput);
    if (supabase && actorId && !dryRun) {
        const { error: saveError } = await supabase.from("judgement_runs").insert({
          case_id: typeof input.caseId === "string" ? input.caseId : null,
          error_type_label: String(input.errorType),
          rule_id: result.ruleId,
          rule_status: result.ruleStatus,
          recommendation: result.recommendation,
          final_decision: "PENDING",
          reason: result.reason,
          input_snapshot: input,
          evaluation_trace: result.evaluations,
          source_references: result.sourceReferences,
          manual_tasks: result.manualTasks,
          prepared_by: actorId
        });
        if (saveError) return NextResponse.json({ error: `Evaluation completed but could not be saved: ${saveError.message}` }, { status: 500 });
    }
    return NextResponse.json({ result, dryRun }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Judgement evaluation failed." }, { status: 422 });
  }
}
