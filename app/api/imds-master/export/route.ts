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
  "STATUS UPDATE", "ID/Ver", "Date", "Comment", "LPOP Confirmation", "CEK",
  "Supplier Promise Date", "MasterKey"
];

function printable(value: unknown): string | number | boolean {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(printable).filter(Boolean).join("; ");
  if (typeof value === "object") return JSON.stringify(value);
  return value as string | number | boolean;
}

function cleanExtraHeader(value: string) {
  return value.replace(/\s+\[col\s+\d+\]$/i, "").trim();
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

  const reserved = new Set(CORE_HEADERS.map((header) => header.toLowerCase()));
  const extraKeyMap = new Map<string, string>();
  const extraCounts = new Map<string, number>();
  for (const row of rows) {
    const extra = (row.extra_fields || {}) as Record<string, unknown>;
    for (const sourceKey of Object.keys(extra)) {
      const base = cleanExtraHeader(sourceKey);
      if (!base || reserved.has(base.toLowerCase())) continue;
      if (extraKeyMap.has(sourceKey)) continue;
      const count = (extraCounts.get(base.toLowerCase()) || 0) + 1;
      extraCounts.set(base.toLowerCase(), count);
      extraKeyMap.set(sourceKey, count === 1 ? base : `${base} (${count})`);
    }
  }
  const extraHeaders = [...new Set(extraKeyMap.values())];
  const headers = [...CORE_HEADERS, ...extraHeaders];

  const workbook = new ExcelJS.Workbook();
  workbook.creator = auth.displayName || auth.email || "IMDS Tracker";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  const sheet = workbook.addWorksheet("Part List LATEST", { views: [{ state: "frozen", ySplit: 6 }] });
  for (let index = 0; index < 5; index++) sheet.addRow([]);
  const tableRows = rows.map((row) => {
    const extra = (row.extra_fields || {}) as Record<string, unknown>;
    const md = Array.isArray(row.md_system_records) ? (row.md_system_records as Record<string, unknown>[])[0] || {} : {};
    const originalNo = extra["No. [col 1]"] ?? extra["No."] ?? "";
    const core = [
      printable(originalNo) || (Number(row.source_row || 0) > 6 ? Number(row.source_row) - 6 : ""),
      row.project, row.vendor_code, row.main_pic_email, row.company_name, row.part_name, row.part_no,
      row.submission_plan, row.imds_status, row.imds_id_version, row.part_status, row.have_respond_email,
      row.status_update || md.status, row.md_id_version || md.idVersion,
      row.md_status_update_date || md.lastStatusChanged, row.comment || md.reasonForDenial,
      row.lpop_confirmation, row.cek, row.supplier_promise_date, row.master_key
    ];
    return [
      ...core.map(printable),
      ...[...extraKeyMap.entries()].map(([sourceKey]) => printable(extra[sourceKey]))
    ];
  });

  sheet.addTable({
    name: "PartMaster",
    ref: "A6",
    headerRow: true,
    totalsRow: false,
    style: { theme: "TableStyleMedium2", showRowStripes: true, showColumnStripes: false },
    columns: headers.map((name) => ({ name })),
    rows: tableRows
  });

  sheet.getRow(6).height = 34;
  sheet.getRow(6).alignment = { vertical: "middle", wrapText: true };
  sheet.columns.forEach((column, index) => {
    column.width = index === 4 ? 34 : index === 5 ? 30 : index === 6 ? 20 : index === 3 ? 30 : index === 0 ? 8 : index === 19 ? 40 : 18;
  });

  // Preserve every MD System result, not just the latest status shown in the Part List LATEST view.
  const history = workbook.addWorksheet("MD System History", { views: [{ state: "frozen", ySplit: 1 }] });
  const historyHeaders = [
    "MasterKey", "PROJECT", "VENDOR CODE", "COMPANY NAME", "P/No.", "Type", "Name",
    "MD Part/Item No.", "ID / Version", "Status", "Reason for denial", "Last status changed",
    "From company", "MD Supplier Code", "Legacy Spare Part", "Legacy Status",
    "Legacy Last Status Changed", "Follow Up Date", "Legacy Reason for denial",
    "Match Status", "Match Reason", "Source File", "Source Row"
  ];
  const historyRows: unknown[][] = [];
  for (const row of rows) {
    const records = Array.isArray(row.md_system_records) ? row.md_system_records as Record<string, unknown>[] : [];
    for (const md of records) {
      historyRows.push([
        row.master_key, row.project, row.vendor_code, row.company_name, row.part_no, md.type, md.name,
        md.partNo, md.idVersion, md.status, md.reasonForDenial, md.lastStatusChanged, md.fromCompany,
        md.mdSupplierCode, md.legacySparePart, md.legacyStatus, md.legacyLastStatusChanged, md.followUpDate,
        md.legacyReasonForDenial, md.matchStatus, md.matchReason, md.sourceFile, md.sourceRow
      ].map(printable));
    }
  }
  history.addTable({
    name: "MdSystemHistory",
    ref: "A1",
    headerRow: true,
    totalsRow: false,
    style: { theme: "TableStyleMedium4", showRowStripes: true },
    columns: historyHeaders.map((name) => ({ name })),
    rows: historyRows
  });
  history.getRow(1).height = 34;
  history.columns.forEach((column, index) => { column.width = index === 4 || index === 7 ? 22 : index === 9 || index === 10 || index === 18 ? 34 : 18; });

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
