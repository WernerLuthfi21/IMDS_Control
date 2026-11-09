import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getAuthContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { canAccessImdsTracker } from "@/lib/security/imds-tracker";
import { mapMdStatusToImds } from "@/lib/imds-master/md-current";

export const runtime = "nodejs";
export const maxDuration = 60;

const HEADERS = [
  "NO.", "PROJECT", "VENDOR CODE", "MAIN PIC EMAIL", "COMPANY NAME", "PART NAME", "PART NO.",
  "SUBMISSION PLAN", "PART STATUS", "ID / VER", "STATUS DATE", "COMMENT", "KEY"
];

function printable(value: unknown): string | number | boolean {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(printable).filter(Boolean).join("; ");
  if (typeof value === "object") return JSON.stringify(value);
  return value as string | number | boolean;
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
      .select("id,master_key,source_row,project,vendor_code,main_pic_email,company_name,part_name,part_no,submission_plan,supplier_promise_date,imds_status,imds_id_version,part_status,have_respond_email,status_update,md_id_version,md_status_update_date,comment,lpop_confirmation,cek,md_system_records,extra_fields")
      .order("project", { ascending: true, nullsFirst: true })
      .order("company_name", { ascending: true, nullsFirst: true })
      .order("part_no", { ascending: true, nullsFirst: true })
      .range(from, from + 499);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    rows.push(...(data || []) as Record<string, unknown>[]);
    if (!data || data.length < 500) break;
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = auth.displayName || auth.email || "IMDS Tracker";
  workbook.created = new Date();
  workbook.modified = new Date();

  const sheet = workbook.addWorksheet("Part List LATEST", { views: [{ state: "frozen", ySplit: 6, xSplit: 7 }] });
  sheet.getCell("A1").value = "IMDS SUPER MASTER";
  sheet.getCell("A1").font = { bold: true, size: 14, color: { argb: "FF14532D" } };
  sheet.getCell("A2").value = "Shared with the IMDS Tracker website. Do not rename the columns or the table PartMaster; do not edit the hidden KEY column.";
  const tableRows = rows.map((row) => {
    const extra = (row.extra_fields || {}) as Record<string, unknown>;
    const md = Array.isArray(row.md_system_records) ? (row.md_system_records as Record<string, unknown>[])[0] || {} : {};
    const originalNo = extra["No. [col 1]"] ?? extra["No."] ?? "";
    return [
      printable(originalNo) || (Number(row.source_row || 0) > 6 ? Number(row.source_row) - 6 : ""),
      row.project, row.vendor_code, row.main_pic_email, row.company_name, row.part_name, row.part_no,
      row.submission_plan, row.imds_status || mapMdStatusToImds(String(md.status ?? "")) || "",
      row.imds_id_version || row.md_id_version || md.idVersion,
      row.md_status_update_date || md.lastStatusChanged, row.comment || md.reasonForDenial, row.master_key
    ].map(printable);
  });
  sheet.addTable({
    name: "PartMaster",
    ref: "A6",
    headerRow: true,
    totalsRow: false,
    style: { theme: "TableStyleMedium7", showRowStripes: true, showColumnStripes: false },
    columns: HEADERS.map((name) => ({ name })),
    rows: tableRows.length ? tableRows : [HEADERS.map(() => "")]
  });
  sheet.getRow(6).height = 30;
  sheet.getRow(6).alignment = { vertical: "middle", wrapText: true };
  [7, 12, 14, 30, 34, 30, 20, 16, 18, 18, 14, 34, 40].forEach((w, i) => { sheet.getColumn(i + 1).width = w; });
  for (const n of [8, 11]) sheet.getColumn(n).numFmt = "yyyy-mm-dd";
  sheet.getColumn(13).hidden = true; // KEY: row identity for Power Automate; people never need to see it

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
