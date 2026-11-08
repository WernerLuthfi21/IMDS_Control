import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getAuthContext } from "@/lib/auth/session";
import { analyzeMatrix, type AnswerMap } from "@/lib/intake/analyze";
import { FIELD_LABEL, type Field } from "@/lib/intake/detect";
import { byPart, resolution, STATE_LABEL } from "@/lib/intake/resolution";

export const runtime = "nodejs";
export const maxDuration = 30;
const FIELDS = Object.keys(FIELD_LABEL);
const safe = (v: string) => (/^[=+\-@\t\r]/.test(v) ? "'" + v : v); // block spreadsheet formula injection

/** Builds the recap workbook from the same inputs as /analyze (the server recomputes; the browser's numbers are never trusted). */
export async function POST(request: NextRequest) {
  const auth = await getAuthContext();
  if (!auth.configured) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  if (!auth.userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!auth.role || !["supplier", "admin", "preparer", "reviewer"].includes(auth.role)) return NextResponse.json({ error: "Supplier or internal role required." }, { status: 403 });
  const text = await request.text();
  if (text.length > 4_000_000) return NextResponse.json({ error: "The data is too large for one recap." }, { status: 413 });
  let body: { matrix?: unknown; mapping?: unknown; headerRow?: unknown; answers?: unknown; fileName?: unknown } | null = null;
  try { body = JSON.parse(text); } catch { /* below */ }
  const matrix = body?.matrix;
  if (!Array.isArray(matrix) || matrix.length < 1 || matrix.length > 5030 || !matrix.every((r) => Array.isArray(r) && r.length <= 80 && r.every((c) => typeof c === "string" && c.length <= 500))) return NextResponse.json({ error: "Send the table as rows of text." }, { status: 400 });
  let mapping: Partial<Record<Field, number>> | undefined;
  if (body?.mapping && typeof body.mapping === "object") { mapping = {}; for (const [k, v] of Object.entries(body.mapping as Record<string, unknown>)) if (FIELDS.includes(k) && Number.isInteger(v) && (v as number) >= 0 && (v as number) < 80) mapping[k as Field] = v as number; }
  const answers: AnswerMap = {};
  if (body?.answers && typeof body.answers === "object") for (const [key, a] of Object.entries(body.answers as Record<string, unknown>)) { if (key.length > 120 || !a || typeof a !== "object") continue; const clean: Record<string, string> = {}; for (const [q, v] of Object.entries(a as Record<string, unknown>)) if (/^[A-Za-z0-9]{1,24}$/.test(q) && typeof v === "string" && v.length <= 40) clean[q] = v; answers[key] = clean; }
  const headerRow = body?.headerRow === null ? null : Number.isInteger(body?.headerRow) ? (body!.headerRow as number) : undefined;
  const analysis = analyzeMatrix(matrix as string[][], { mapping, headerRow, answers });
  const fileName = typeof body?.fileName === "string" ? body.fileName.slice(0, 120) : "";

  const wb = new ExcelJS.Workbook();
  wb.creator = "IMDS workspace"; wb.created = new Date();
  const head = (ws: ExcelJS.Worksheet) => { ws.getRow(1).font = { bold: true }; ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6F1E9" } }; ws.views = [{ state: "frozen", ySplit: 1 }]; };

  const s = wb.addWorksheet("Summary");
  s.columns = [{ width: 34 }, { width: 70 }];
  s.addRows([["Self-check recap", ""], ["Source file", safe(fileName)], ["Generated (UTC)", new Date().toISOString().slice(0, 19).replace("T", " ")], ["Items checked", analysis.rows.length],
    ...(Object.keys(STATE_LABEL) as (keyof typeof STATE_LABEL)[]).map((k) => [STATE_LABEL[k], analysis.counts[k]]), ["", ""],
    ["Important", "Preliminary supplier self-check only. It is NOT a G-CATS decision and NOT an IMDS upload file: IMDS accepts uploads in its own XML format only. Toyota makes the final OK/NG."]]);
  s.getRow(1).font = { bold: true, size: 14 }; s.getCell("B12").alignment = { wrapText: true };

  const p = wb.addWorksheet("By part number");
  p.columns = [{ header: "Part No.", width: 24 }, { header: "Overall", width: 22 }, { header: "Items", width: 8 }, { header: "NG", width: 6 }, { header: "Answer needed", width: 14 }, { header: "Fix data", width: 10 }];
  for (const x of byPart(analysis.rows)) p.addRow([safe(x.partNo), STATE_LABEL[x.worst], x.items.length, x.counts.NG, x.counts.ASK, x.counts.INVALID]);
  head(p);

  const it = wb.addWorksheet("Items");
  it.columns = [{ header: "Row", width: 6 }, { header: "Part No.", width: 22 }, { header: "CAS / item", width: 16 }, { header: "Check", width: 28 }, { header: "Result", width: 20 }, { header: "What to do", width: 70 }, { header: "Your answer", width: 30 }];
  for (const r of analysis.rows) it.addRow([r.r, safe(r.partNo), safe(r.cas || (r.family === "pb" ? "Pb" : r.family === "mass" ? "Mass" : "")), safe(r.flowTitle), STATE_LABEL[r.state], safe(resolution(r)), safe(Object.values(r.answered).join(", "))]);
  head(it); it.autoFilter = { from: "A1", to: "G1" };
  it.eachRow((row, n) => { if (n === 1) return; const v = String(row.getCell(5).value); const c = v === "NG" || v === "Fix data" ? "FFFBE4E6" : v === "Answer needed" ? "FFFEF3C7" : v === "OK" ? "FFE6F1E9" : ""; if (c) row.getCell(5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: c } }; });

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as ArrayBuffer, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": 'attachment; filename="self-check-recap.xlsx"', "Cache-Control": "no-store" } });
}
