import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { partKey } from "@/lib/intake/keys";

export const runtime = "nodejs";
const FAMILIES = ["substance", "pb", "mass", "sms", "app44"];

/** A supplier saves the answers it gave in its self-check. Stored per part number; TMMIN's judgement then reuses them. */
export async function POST(request: NextRequest) {
  const auth = await getAuthContext();
  if (!auth.configured) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  if (!auth.userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (auth.role !== "supplier") return NextResponse.json({ error: "Only supplier accounts can save confirmations." }, { status: 403 });
  const supabase = (await createClient())!;
  const { data: profile } = await supabase.from("profiles").select("supplier_code").eq("id", auth.userId).maybeSingle();
  const supplierCode = profile?.supplier_code?.trim();
  if (!supplierCode) return NextResponse.json({ error: "Your account has no supplier code yet. Ask TMMIN to set it." }, { status: 403 });
  const body = await request.json().catch(() => null) as { items?: unknown; fileName?: unknown } | null;
  if (!body || !Array.isArray(body.items) || !body.items.length) return NextResponse.json({ error: "No confirmations to save." }, { status: 400 });
  if (body.items.length > 500) return NextResponse.json({ error: "Save at most 500 confirmations at a time." }, { status: 413 });
  const fileName = typeof body.fileName === "string" ? body.fileName.slice(0, 120) : null;
  const rows: Record<string, unknown>[] = [];
  for (const raw of body.items as Array<Record<string, unknown>>) {
    const partNo = String(raw.partNo ?? "").trim();
    const family = String(raw.family ?? "");
    if (!partNo || partNo.length > 40 || !FAMILIES.includes(family)) return NextResponse.json({ error: "Each confirmation needs a part number and a valid family." }, { status: 422 });
    const answers: Record<string, string> = {};
    for (const [k, v] of Object.entries((raw.answers && typeof raw.answers === "object" ? raw.answers : {}) as Record<string, unknown>)) {
      if (/^[A-Za-z0-9]{1,24}$/.test(k) && typeof v === "string" && /^[A-Za-z0-9_]{1,40}$/.test(v)) answers[k] = v;
    }
    if (!Object.keys(answers).length) continue;
    rows.push({
      supplier_code: supplierCode, delivery_part_no: partNo, part_key: partKey(partNo), family,
      cas: family === "substance" ? String(raw.cas ?? "").slice(0, 20) : "",
      flow_id: String(raw.flowId ?? "").slice(0, 40) || null, flow_title: String(raw.flowTitle ?? "").slice(0, 120) || null,
      error_type: String(raw.errorType ?? "").slice(0, 80) || null, answers,
      result_state: String(raw.resultState ?? "").slice(0, 12) || null, result_comment: String(raw.resultComment ?? "").slice(0, 200) || null,
      source_file_name: fileName, submitted_by: auth.userId
    });
  }
  if (!rows.length) return NextResponse.json({ error: "Answer at least one question before saving." }, { status: 422 });
  const { error } = await supabase.from("supplier_confirmations").insert(rows);
  if (error) return NextResponse.json({ error: /does not exist|schema cache/i.test(error.message) ? "The confirmations table is not installed yet (migration 20261106000000 must be applied)." : error.message }, { status: 500 });
  return NextResponse.json({ saved: rows.length });
}
