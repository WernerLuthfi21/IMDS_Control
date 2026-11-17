import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ESCALATION_TABLE_MISSING } from "@/lib/judgement/escalation";
import { partKey } from "@/lib/judgement/memory";

export const runtime = "nodejs";
const EDIT_ROLES = ["admin", "preparer", "reviewer"];
const HINT = "Run supabase/migrations/20261118010000_judgement_escalations.sql in the Supabase SQL editor.";

/** Record that a case was sent to TMC, or what TMC answered. The answer is reused for identical cases. */
export async function POST(request: NextRequest) {
  const auth = await getAuthContext();
  if (!auth.configured) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  if (!auth.userId || !EDIT_ROLES.includes(auth.role || "")) return NextResponse.json({ error: "Preparer, reviewer or admin role is required." }, { status: 403 });
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const b = await request.json().catch(() => null) as Record<string, unknown> | null;
  const key = typeof b?.key === "string" ? b.key.slice(0, 300) : "";
  const action = String(b?.action || "");
  const answer = b?.answer === "OK" || b?.answer === "NG" ? b.answer : null;
  const note = typeof b?.note === "string" ? b.note.trim().slice(0, 1000) : "";
  if (key.split("|").length !== 4 || !["sent", "answered", "reset"].includes(action)) return NextResponse.json({ error: "Invalid escalation request." }, { status: 400 });
  if (action === "answered" && !answer) return NextResponse.json({ error: "Choose what TMC answered (OK or NG)." }, { status: 400 });
  const now = new Date().toISOString(), who = auth.displayName || auth.email || "Reviewer";
  const { data: cur, error: readError } = await supabase.from("judgement_escalations").select("history,sent_at").eq("case_key", key).maybeSingle();
  if (readError) {
    const missing = ESCALATION_TABLE_MISSING.test(readError.message);
    return NextResponse.json({ error: missing ? "TMC tracking is not available yet. " + HINT : readError.message }, { status: missing ? 503 : 500 });
  }
  const status = action === "sent" ? "SENT" : action === "answered" ? "CONFIRMED" : "NEED";
  const history = [...(Array.isArray(cur?.history) ? cur.history : []), { at: now, by: who, status, answer, note }].slice(-50);
  const [part, errorType, cas, flowId] = key.split("|");
  const itemId = typeof b?.itemId === "string" && /^[0-9a-f-]{36}$/i.test(b.itemId) ? b.itemId : null;
  const row = {
    case_key: key, part_no: partKey(part === "-" ? "" : part) || null, error_type: errorType || null, cas: cas === "-" ? null : cas, flow_id: flowId === "-" ? null : flowId,
    item_id: itemId, status, answer: status === "CONFIRMED" ? answer : null, note: note || null,
    sent_at: action === "sent" ? now : action === "reset" ? null : cur?.sent_at ?? null,
    answered_at: status === "CONFIRMED" ? now : null,
    updated_by: auth.userId, updated_by_name: who, history, updated_at: now
  };
  const { error } = await supabase.from("judgement_escalations").upsert(row, { onConflict: "case_key" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await supabase.from("audit_events").insert({ actor_id: auth.userId, action: "JUDGEMENT_TMC_" + status, entity_type: "judgement_escalation", metadata: { key, answer, note, itemId } });
  return NextResponse.json({ ok: true, status, answer: row.answer, at: now, by: who });
}
