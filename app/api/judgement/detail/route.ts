import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getAuthContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { buildPartDetails, DETAIL_COLUMNS, type DetailInput, type PartDetail } from "@/lib/judgement/gcats-detail";

export const runtime = "nodejs";
export const maxDuration = 60;
const INTERNAL = ["admin", "preparer", "reviewer", "viewer", "rule_author", "rule_approver"];
const MAX_PARTS = 200;

/**
 * G-CATS Detail per delivery part number, for TMA to check before a person types the result into
 * TMC's G-CATS. GET ?parts=A,B (JSON) or &format=xlsx (download). Read-only; nothing is sent anywhere.
 */
export async function GET(request: NextRequest) {
  const auth = await getAuthContext();
  if (!auth.configured) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  if (!auth.userId || !auth.role || !INTERNAL.includes(auth.role)) return NextResponse.json({ error: "Internal sign-in is required." }, { status: 401 });
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Database connection is unavailable." }, { status: 503 });

  const parts = [...new Set((request.nextUrl.searchParams.get("parts") || "").split(",").map((p) => p.trim()).filter(Boolean))];
  if (!parts.length || parts.length > MAX_PARTS || parts.some((p) => p.length > 40)) {
    return NextResponse.json({ error: `Choose 1–${MAX_PARTS} part numbers.` }, { status: 400 });
  }
  const { data: latest, error: latestError } = await supabase.from("gcat_error_items")
    .select("source_batch_id").not("source_batch_id", "is", null)
    .order("source_last_seen_at", { ascending: false }).limit(1).maybeSingle();
  if (latestError) return NextResponse.json({ error: latestError.message }, { status: 500 });
  if (!latest?.source_batch_id) return NextResponse.json({ error: "No committed G-CATS snapshot yet." }, { status: 404 });

  const items: DetailInput[] = [];
  for (let i = 0; i < parts.length; i += 50) {
    const { data, error } = await supabase.from("gcat_error_items")
      .select("id,source_record_key,error_type_label,delivery_part_no,supplier_code,judge,ok_comment,imds_reject_comment,raw_source")
      .eq("source_batch_id", latest.source_batch_id)
      .in("delivery_part_no", parts.slice(i, i + 50))
      .order("source_record_key", { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    items.push(...((data || []) as unknown as DetailInput[]));
  }
  const details = buildPartDetails(items);

  if (request.nextUrl.searchParams.get("format") !== "xlsx") {
    return NextResponse.json({ details, notFound: parts.filter((p) => !details.some((d) => d.header.deliveryPartNo.toUpperCase() === p.toUpperCase())) }, { headers: { "Cache-Control": "no-store" } });
  }
  const buffer = await workbook(details, auth.displayName || auth.email || "");
  const name = parts.length === 1 ? `GCATS-Detail-${parts[0].replace(/[^A-Za-z0-9_-]/g, "")}.xlsx` : `GCATS-Detail-TMA-${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new NextResponse(buffer, { status: 200, headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename=${name}`, "Cache-Control": "no-store"
  } });
}

async function workbook(details: PartDetail[], preparedBy: string) {
  const wb = new ExcelJS.Workbook(); wb.creator = "IMDS / G-CATS Control Center"; wb.created = new Date();
  const ws = wb.addWorksheet("G-CATS Detail (TMA check)");
  ws.addRow([`Prepared by the app for TMA check — entered into G-CATS manually by a person. Prepared ${new Date().toISOString().slice(0, 10)}${preparedBy ? " · " + preparedBy : ""}`]).font = { italic: true, color: { argb: "FF555555" } };
  ws.addRow([]);
  const head = ["Area Code", "Supplier Code", "Delivery Part No.", "Bus. Ent.", "Company Name", ...DETAIL_COLUMNS.map(([, l]) => l), "TMA check (OK / comment)", "Source record"];
  const hr = ws.addRow(head);
  hr.font = { bold: true, color: { argb: "FFFFFFFF" } };
  hr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2A1FB8" } };
  hr.alignment = { vertical: "middle", wrapText: true }; hr.height = 30;
  for (const d of details) {
    for (const r of d.rows) {
      const row = ws.addRow([d.header.areaCode, d.header.supplierCode, d.header.deliveryPartNo, d.header.busEnt, d.header.companyName, ...DETAIL_COLUMNS.map(([k]) => r[k]), "", r.sourceRecordKey]);
      const check = row.getCell(6);
      if (r.check) check.fill = { type: "pattern", pattern: "solid", fgColor: { argb: r.check === "OK" ? "FFDCFCE7" : "FFFFE4E6" } };
      row.getCell(7).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE7B0" } };
    }
    const sms = ws.addRow(["", "", d.header.deliveryPartNo, "", "SMS Parts/Mass", "Drawing Mass(g) Max " + (d.sms.drawingMax || "—"), "Min " + (d.sms.drawingMin || "—"), "Actual Max " + (d.sms.actualMax || "—"), "Actual Min " + (d.sms.actualMin || "—"), "Drawing " + (d.sms.drawing || "—"), "2D " + (d.sms.drawing2d || "—"), "3D " + (d.sms.drawing3d || "—"), "Status " + (d.sms.drawingStatus || "—")]);
    sms.font = { italic: true, color: { argb: "FF555555" } };
    ws.addRow([]);
  }
  ws.views = [{ state: "frozen", ySplit: 3, xSplit: 3 }];
  ws.columns.forEach((c, i) => { c.width = [10, 12, 16, 10, 28, 8, 26, 40, 36, 26, 10, 8, 18, 26, 20, 12, 12, 14, 30, 12, 14, 28, 22][i] || 16; });
  return wb.xlsx.writeBuffer();
}
