import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { runAutoWorkflow } from "@/lib/judgement/auto";
import { extractRowFacts } from "@/lib/judgement/row-facts";
import { detectKind } from "@/lib/judgement/auto";
import { familyOfKind, loadConfirmation, describeAnswers } from "@/lib/intake/confirmations";
import { normalizeCas } from "@/lib/reference-data";
import { describeMemory, loadPartMemory, type PartMemory } from "@/lib/judgement/memory";
import { escalationKey, loadEscalations, needsTmc, tmcRecommendation, type Escalation } from "@/lib/judgement/escalation";

export const runtime = "nodejs";
const DESTINATIONS = ["EU", "KR", "CN", "TW", "IN", "JP", "OTH"];
const CONFIRMATIONS = ["ACTUAL_OR_CALCULATED_MASS", "INPUT_MISTAKE", "SUPPLIER_CONFIRMED"];

/** Non-persistent automatic workflow for one register row. Never writes; saving stays a human action. */
export async function POST(request: NextRequest) {
  const auth = await getAuthContext();
  if (!auth.configured) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  if (!auth.userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!auth.role || auth.role === "supplier") return NextResponse.json({ error: "Internal role required." }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const itemId = typeof body?.itemId === "string" ? body.itemId : "";
  if (!/^[0-9a-f-]{36}$/i.test(itemId)) return NextResponse.json({ error: "Invalid item id." }, { status: 400 });
  const destination = typeof body?.destination === "string" && DESTINATIONS.includes(body.destination) ? body.destination : undefined;
  const toleranceClass = typeof body?.toleranceClass === "string" && /^M[A-F]$/.test(body.toleranceClass) ? body.toleranceClass : undefined;
  const supplierConfirmation = typeof body?.supplierConfirmation === "string" && CONFIRMATIONS.includes(body.supplierConfirmation) ? body.supplierConfirmation : undefined;
  const supabase = await createClient();
  const { data: item, error } = await supabase!.from("gcat_error_items").select("error_type_label,raw_source,supplier_code,delivery_part_no").eq("id", itemId).maybeSingle();
  if (error || !item) return NextResponse.json({ error: error?.message || "Register row not found." }, { status: 404 });
  const facts = extractRowFacts(item.raw_source as Record<string, unknown> | null);
  const answers: Record<string, string> = {};
  if (body?.answers && typeof body.answers === "object" && !Array.isArray(body.answers)) {
    for (const [k, v] of Object.entries(body.answers as Record<string, unknown>)) if (/^[A-Za-z0-9]{1,24}$/.test(k) && typeof v === "string" && v.length <= 8) answers[k] = v;
  }
  // A saved supplier self-check answer for this part is used automatically; anything the reviewer picks in the UI wins.
  const family = familyOfKind(detectKind(item.error_type_label));
  const stored = family ? await loadConfirmation(supabase!, item, family, normalizeCas(facts.cas || "")) : null;
  // What Toyota already answered for this part is reused; anything picked in the UI wins.
  let memory: PartMemory = {};
  let memoryAvailable = true;
  try { const m = await loadPartMemory(supabase!, [item.delivery_part_no || ""]); memoryAvailable = m.available; memory = m.map.values().next().value ?? {}; } catch { memoryAvailable = false; }
  const remembered: Record<string, string> = {};
  for (const [field, entry] of Object.entries(memory)) if (entry && field !== "destination" && field !== "toleranceClass") remembered[field] = entry.value;
  const merged: Record<string, string> = { ...(stored?.answers ?? {}), ...remembered, ...answers };
  const destinationUsed = destination ?? memory.destination?.value;
  const supplierConfirmationUsed = supplierConfirmation ?? (stored?.answers.supplierConfirmation && CONFIRMATIONS.includes(stored.answers.supplierConfirmation) ? stored.answers.supplierConfirmation : undefined);
  // The tolerance class is Toyota's (drawing). A class a supplier once typed in a self-check is never used.
  const toleranceClassUsed = toleranceClass ?? (!facts.toleranceClass ? memory.toleranceClass?.value : undefined);
  const result = runAutoWorkflow({ errorType: item.error_type_label, facts, supplierCode: item.supplier_code, destination: destinationUsed, toleranceClass: toleranceClassUsed, supplierConfirmation: supplierConfirmationUsed, answers: merged });
  const usedMemory = Object.values(memory).filter((e) => e && (e.field !== "destination" || !destination) && (e.field !== "toleranceClass" || (!toleranceClass && !facts.toleranceClass)));
  if (usedMemory.length) {
    result.steps.unshift({ id: "memory", title: "Remembered for this part", status: "DONE", detail: usedMemory.map((e) => `${e!.field === "destination" ? "Destination" : e!.field === "toleranceClass" ? "Tolerance class" : e!.field} ${e!.value} · ${describeMemory(e!)}`).join(" · ") });
  }
  if (stored) {
    const when = stored.submitted_at.slice(0, 10);
    result.steps.unshift({ id: "supplier-confirmation", title: "Supplier confirmation on file", status: "DONE", detail: `${stored.supplier_code} answered in its self-check on ${when}${stored.source_file_name ? ` (${stored.source_file_name})` : ""}: ${describeAnswers(stored.answers)}. Self-reported by the supplier; you still decide.` });
    result.procedureText = [result.procedureText, `Supplier self-check confirmation (${stored.supplier_code}, ${when}): ${describeAnswers(stored.answers)}.`].filter(Boolean).join("\n");
  }
  let tmc: { key: string; status: Escalation["status"]; answer: "OK" | "NG" | null; note: string; sentAt: string | null; answeredAt: string | null; by: string | null } | null = null;
  if (needsTmc(result.recommendation.reason)) {
    const key = escalationKey({ partNo: item.delivery_part_no, errorType: item.error_type_label, cas: facts.cas, flowId: result.flow?.flowId });
    let esc: Escalation | undefined;
    try { esc = (await loadEscalations(supabase!, [item.delivery_part_no || ""])).map.get(key); } catch { esc = undefined; }
    tmc = { key, status: esc?.status ?? "NEED", answer: esc?.answer ?? null, note: esc?.note ?? "", sentAt: esc?.sentAt ?? null, answeredAt: esc?.answeredAt ?? null, by: esc?.updatedByName ?? null };
    const rec = esc ? tmcRecommendation(esc) : null;
    if (rec) {
      result.recommendation = rec;
      result.steps.push({ id: "tmc", title: "TMC confirmation", status: "DONE", detail: rec.reason });
      result.procedureText = [result.procedureText, `4) TMC confirmation: ${rec.comment}`].filter(Boolean).join("\n");
    } else {
      result.steps.push({ id: "tmc", title: "TMC confirmation", status: "NEEDS_INPUT", detail: esc?.status === "SENT" ? `Sent to TMC${esc.sentAt ? " on " + esc.sentAt.slice(0, 10) : ""}; waiting for the answer.` : "Ask TMC/TMNA/TME/TDEM, then record the answer here. It will be reused for identical cases." });
    }
  }
  return NextResponse.json({ result, tmc, memory: { available: memoryAvailable, values: Object.fromEntries(Object.entries(memory).map(([k, e]) => [k, e ? { value: e.value, note: describeMemory(e) } : null])) }, confirmation: stored ? { submittedAt: stored.submitted_at, supplierCode: stored.supplier_code } : null }, { headers: { "Cache-Control": "no-store" } });
}
