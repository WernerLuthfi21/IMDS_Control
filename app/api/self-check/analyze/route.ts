import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { analyzeMatrix, type AnswerMap } from "@/lib/intake/analyze";
import type { Field } from "@/lib/intake/detect";
import { FIELD_LABEL } from "@/lib/intake/detect";

export const runtime = "nodejs";
export const maxDuration = 30;
const FIELDS = Object.keys(FIELD_LABEL);

/** Read-only: detect columns and run the automatic self-check on pasted or parsed table data. Nothing is stored here. */
export async function POST(request: NextRequest) {
  const auth = await getAuthContext();
  if (!auth.configured) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  if (!auth.userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!auth.role || !["supplier", "admin", "preparer", "reviewer"].includes(auth.role)) return NextResponse.json({ error: "Supplier or internal reviewer role required." }, { status: 403 });
  const text = await request.text();
  if (text.length > 4_000_000) return NextResponse.json({ error: "The data is too large for one check. Split it into parts of about 5,000 rows." }, { status: 413 });
  let body: { matrix?: unknown; mapping?: unknown; headerRow?: unknown; answers?: unknown } | null = null;
  try { body = JSON.parse(text); } catch { /* handled below */ }
  const matrix = body?.matrix;
  if (!Array.isArray(matrix) || matrix.length < 1 || matrix.length > 5030 || !matrix.every((r) => Array.isArray(r) && r.length <= 80 && r.every((c) => typeof c === "string" && c.length <= 500))) return NextResponse.json({ error: "Send a table (rows of text cells), at most 5,000 rows and 80 columns." }, { status: 400 });
  let mapping: Partial<Record<Field, number>> | undefined;
  if (body?.mapping && typeof body.mapping === "object") {
    mapping = {};
    for (const [k, v] of Object.entries(body.mapping as Record<string, unknown>)) if (FIELDS.includes(k) && Number.isInteger(v) && (v as number) >= 0 && (v as number) < 80) mapping[k as Field] = v as number;
  }
  const headerRow = body?.headerRow === null ? null : Number.isInteger(body?.headerRow) ? (body!.headerRow as number) : undefined;
  const answers: AnswerMap = {};
  if (body?.answers && typeof body.answers === "object") {
    for (const [key, a] of Object.entries(body.answers as Record<string, unknown>)) {
      if (key.length > 120 || !a || typeof a !== "object") continue;
      const clean: Record<string, string> = {};
      for (const [q, v] of Object.entries(a as Record<string, unknown>)) if (/^[A-Za-z0-9]{1,24}$/.test(q) && typeof v === "string" && v.length <= 40) clean[q] = v;
      answers[key] = clean;
    }
  }
  const analysis = analyzeMatrix(matrix as string[][], { mapping, headerRow, answers });
  return NextResponse.json({ analysis }, { headers: { "Cache-Control": "no-store" } });
}
