import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/server";
export const runtime = "nodejs";
export async function GET() {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (!profile || !["admin", "preparer", "reviewer", "viewer"].includes(profile.role)) return NextResponse.json({ error: "Internal workspace access required." }, { status: 403 });
  const { data, error } = await supabase.from("gcat_error_items").select("source_record_key,source_code,source_year,source_month,source_status,delivery_part_no,delivery_part_name,supplier_code,error_type_label,cas_no,substance_name,assigned_person,starting_date,judgement_procedure,judge,ok_comment,imds_reject_comment,km_judge,km_comment,last_change_date,source_judge_label,source_km_judge_label").order("source_year", { ascending: false }).order("source_month", { ascending: false }).limit(100000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const wb = new ExcelJS.Workbook(); wb.creator = "IMDS / G-CATS Judgement Register"; wb.created = new Date();
  const ws = wb.addWorksheet("Judgement Register");
  const headers = ["Source Record Key", "G-CATS code", "Year", "Month", "Source Status", "Delivery Part No", "Delivery Part Name", "Supplier Code", "Error Type", "CAS No.", "Substance Name", "Assigned person", "The starting date", "Judgement procedure", "Judge (OK/NG)", "Comment of Record of changing to OK (Required)", "IMDS Reject comment", "KM Judge (OK/NG)", "KM Comment", "Last Change Date", "Original G-CATS Judge label", "Original KM Judge label"];
  ws.addRow(headers);
  for (const r of data || []) ws.addRow([r.source_record_key, r.source_code, r.source_year, r.source_month, r.source_status, r.delivery_part_no, r.delivery_part_name, r.supplier_code, r.error_type_label, r.cas_no, r.substance_name, r.assigned_person, r.starting_date, r.judgement_procedure, r.judge, r.ok_comment, r.imds_reject_comment, r.km_judge, r.km_comment, r.last_change_date, r.source_judge_label, r.source_km_judge_label]);
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, (data || []).length + 1), column: headers.length } };
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF26343F" } };
  ws.getRow(1).alignment = { vertical: "middle", wrapText: true }; ws.getRow(1).height = 32;
  ws.columns.forEach((c, i) => { c.width = [22, 16, 9, 13, 16, 20, 28, 14, 30, 15, 26, 20, 15, 58, 14, 46, 46, 15, 40, 20][i] || 18; });
  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(buffer, { status: 200, headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": "attachment; filename=IMDS-GCATS-Judgement-Register.xlsx", "Cache-Control": "no-store" } });
}
