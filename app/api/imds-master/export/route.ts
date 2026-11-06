import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getAuthContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { canAccessImdsTracker } from "@/lib/security/imds-tracker";

export const runtime = "nodejs";
export const maxDuration = 60;

const CORE_HEADERS = [
  "No.", "PROJECT", "VENDOR CODE", "MAIN PIC EMAIL", "COMPANY NAME", "PART NAME", "P/No.",
  "SUBMISSION PLAN", "IMDS STATUS", "ID / Ver", "Part Status", "Have respond email",
  "STATUS UPDATE", "MD ID/Ver", "Date", "Comment", "LPOP Confirmation", "CEK"
];

function printable(value: unknown) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(printable).filter(Boolean).join("; ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export async function GET() {
  const auth = await getAuthContext();
  if (!auth.configured) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  if (!auth.userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!canAccessImdsTracker(auth.role)) return NextResponse.json({ error: "Internal workspace access required." }, { status: 403 });

  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });

  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabase.from("imds_master_parts")
      .select("project,vendor_code,main_pic_email,company_name,part_name,part_no,submission_plan,imds_status,imds_id_version,part_status,have_respond_email,status_update,md_id_version,md_status_update_date,comment,lpop_confirmation,cek,md_system_records,extra_fields")
      .order("project", { ascending: true, nullsFirst: true })
      .order("company_name", { ascending: true, nullsFirst: true })
      .order("part_no", { ascending: true, nullsFirst: true })
      .range(from, from + 499);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    rows.push(...(data || []) as Record<string, unknown>[]);
    if (!data || data.length < 500) break;
  }

  const extraHeaders = [...new Set(rows.flatMap((row) => Object.keys((row.extra_fields || {}) as Record<string, unknown>)))].sort();
  const headers = [
    ...CORE_HEADERS,
    "MD System Type", "MD System Name", "MD System Part No.", "MD System ID / Version",
    "MD System Status", "MD System Reason for denial", "MD System Last Status Changed",
    "MD System From Company", "MD System Supplier Code", "MD System Legacy Spare Part",
    "MD System Legacy Status", "MD System Legacy Last Status Changed", "MD System Follow Up Date",
    "MD System Legacy Reason for denial",
    ...extraHeaders
  ];

  const workbook = new ExcelJS.Workbook();
  workbook.creator = auth.displayName || auth.email || "IMDS Tracker";
  workbook.created = new Date();
  workbook.modified = new Date();
  const sheet = workbook.addWorksheet("Part List LATEST", { views: [{ state: "frozen", ySplit: 6 }] });
  for (let i = 0; i < 5; i++) sheet.addRow([]);
  const header = sheet.addRow(headers);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5126A8" } };
  header.alignment = { vertical: "middle", wrapText: true };
  header.height = 32;

  rows.forEach((row, index) => {
    const mds = Array.isArray(row.md_system_records) ? row.md_system_records as Record<string, unknown>[] : [];
    const m = mds[0] || {};
    const extra = (row.extra_fields || {}) as Record<string, unknown>;
    sheet.addRow([
      index + 1,
      row.project, row.vendor_code, row.main_pic_email, row.company_name, row.part_name, row.part_no,
      row.submission_plan, row.imds_status, row.imds_id_version, row.part_status, row.have_respond_email,
      row.status_update, row.md_id_version, row.md_status_update_date, row.comment, row.lpop_confirmation, row.cek,
      m.type, m.name, m.partNo, m.idVersion, m.status, m.reasonForDenial, m.lastStatusChanged,
      m.fromCompany, m.mdSupplierCode, m.legacySparePart, m.legacyStatus, m.legacyLastStatusChanged,
      m.followUpDate, m.legacyReasonForDenial,
      ...extraHeaders.map((key) => printable(extra[key]))
    ]);
  });

  sheet.columns.forEach((column, i) => {
    column.width = i === 4 ? 34 : i === 5 ? 30 : i === 6 ? 20 : i === 3 ? 30 : i === 0 ? 8 : 18;
  });
  sheet.autoFilter = { from: { row: 6, column: 1 }, to: { row: Math.max(6, 5 + rows.length + 1), column: headers.length } };
  const bytes = await workbook.xlsx.writeBuffer();
  const filename = `IMDS_Super_Master_${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new NextResponse(Buffer.from(bytes as ArrayBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store"
    }
  });
}
