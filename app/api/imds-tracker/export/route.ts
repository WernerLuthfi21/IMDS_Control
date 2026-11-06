import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { trackerAuth } from "@/lib/imds-tracker/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

async function readAllParts(supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>) {
  if (!supabase) return { rows: [], error: "Supabase not configured." };
  const all: Record<string, unknown>[] = [];
  for (let from = 0; from < 10000; from += 1000) {
    const { data, error } = await supabase.from("imds_master_parts").select("*").order("project").order("company_name").order("part_no").range(from, from + 999);
    if (error) return { rows: [], error: error.message };
    all.push(...(data || []) as Record<string, unknown>[]);
    if ((data || []).length < 1000) break;
  }
  return { rows: all, error: null };
}

export async function GET() {
  const ctx = await trackerAuth(["admin", "preparer", "reviewer", "viewer"]);
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  const { rows, error } = await readAllParts(ctx.supabase);
  if (error) return NextResponse.json({ error }, { status: 500 });
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "IMDS Intelligence Control Center";
  workbook.created = new Date();
  const master = workbook.addWorksheet("Part List LATEST", { views: [{ state: "frozen", ySplit: 1 }] });
  const headers = [
    "No.","PROJECT","VENDOR CODE","MAIN PIC EMAIL","COMPANY NAME","PART NAME","P/No.","SUBMISSION PLAN",
    "IMDS STATUS","ID / Ver","Part Status","Have respond email","STATUS UPDATE","ID/Ver","Date","Comment",
    "LPOP Confirmation","CEK","MASTER KEY","MD Type","MD Name","MD Part No.","MD ID / Version","MD Status",
    "MD Reason for denial","MD Last Status Changed","MD From Company","MD Supplier Code","MD Legacy Spare Part",
    "MD Secondary Status","MD Secondary Last Status Changed","MD Follow Up Date","MD Secondary Reason for denial"
  ];
  master.addRow(headers);
  const latestRecords = new Map<string, Record<string, unknown>>();
  rows.forEach((r, index) => {
    const mdRecords = Array.isArray(r.md_system_records) ? r.md_system_records as Record<string, unknown>[] : [];
    const md = mdRecords[0] || {};
    const dateValue = (x: unknown) => x ? String(x).slice(0,10) : "";
    master.addRow([
      r.extra_fields && (r.extra_fields as Record<string, unknown>)["No."] || index + 1,
      r.project || "", r.vendor_code || "", r.main_pic_email || "", r.company_name || "", r.part_name || "",
      r.part_no || "", dateValue(r.submission_plan), r.imds_status || "", r.imds_id_version || "", r.part_status || "",
      r.have_respond_email || "", r.status_update || "", r.md_id_version || "", dateValue(r.md_status_update_date),
      r.comment || "", r.lpop_confirmation || "", r.cek || "", r.master_key || "",
      md.type || "", md.name || "", md.partNo || r.part_no || "", md.idVersion || "", md.status || "",
      md.reasonForDenial || "", dateValue(md.lastStatusChanged), md.fromCompany || "", md.supplierCode || "",
      md.legacySparePart || "", md.secondaryStatus || "", dateValue(md.secondaryLastStatusChanged),
      dateValue(md.followUpDate), md.secondaryReasonForDenial || ""
    ]);
    if (Object.keys(md).length) latestRecords.set(String(r.master_key), { ...md, masterKey: r.master_key, project: r.project, companyName: r.company_name, vendorCode: r.vendor_code });
  });
  master.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  master.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF29223A" } };
  const excelColumn = (n: number) => { let x = n, out = ""; while (x > 0) { const rem = (x - 1) % 26; out = String.fromCharCode(65 + rem) + out; x = Math.floor((x - 1) / 26); } return out; };\n  master.autoFilter = { from: "A1", to: `${excelColumn(headers.length)}${rows.length + 1}` };
  master.columns = headers.map((h) => ({ header: h, width: Math.max(13, Math.min(34, h.length + 3)) }));
  master.getColumn(7).numFmt = "@";
  master.getColumn(3).numFmt = "@";
  master.getColumn(20).numFmt = "@";

  const mdSheet = workbook.addWorksheet("MD System Latest", { views: [{ state: "frozen", ySplit: 1 }] });
  const mdHeaders = ["MASTER KEY","PROJECT","VENDOR CODE","COMPANY NAME","Type","Name","Part/Item No.","ID / Version","Status","Reason for denial","Last status changed","From company","Supplier Code","Legacy Spare Part","Secondary Status","Secondary last status changed","Follow Up Date","Secondary reason for denial"];
  mdSheet.addRow(mdHeaders);
  for (const r of latestRecords.values()) mdSheet.addRow([
    r.masterKey || "", r.project || "", r.vendorCode || "", r.companyName || "", r.type || "", r.name || "",
    r.partNo || "", r.idVersion || "", r.status || "", r.reasonForDenial || "", r.lastStatusChanged || "",
    r.fromCompany || "", r.supplierCode || "", r.legacySparePart || "", r.secondaryStatus || "",
    r.secondaryLastStatusChanged || "", r.followUpDate || "", r.secondaryReasonForDenial || ""
  ]);
  mdSheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  mdSheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF29223A" } };
  mdSheet.autoFilter = { from: "A1", to: `R${latestRecords.size + 1}` };
  mdSheet.columns = mdHeaders.map((h) => ({ header: h, width: Math.max(14, Math.min(38, h.length + 4)) }));

  const out = await workbook.xlsx.writeBuffer();
  return new NextResponse(Buffer.from(out), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="IMDS_Super_Master_${new Date().toISOString().slice(0,10)}.xlsx"`,
      "Cache-Control": "private, no-store"
    }
  });
}
