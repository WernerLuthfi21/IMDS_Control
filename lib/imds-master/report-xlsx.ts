// Per-supplier Excel list of the parts that still need action. Generated on demand, never stored.
import ExcelJS from "exceljs";

export type XlsxPart = { company_name?: string | null; project?: string | null; part_no?: string | null; part_name?: string | null; imds_status?: string | null; imds_id_version?: string | null; md_id_version?: string | null; md_status_update_date?: string | null; submission_plan?: string | null; comment?: string | null };

const safe = (v: unknown) => { const s = String(v ?? ""); return /^[=+\-@\t\r]/.test(s) ? "'" + s : s; };   // spreadsheet formula injection guard

export async function buildUnsubmittedXlsx(supplierName: string, supplierCode: string, parts: XlsxPart[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook(); wb.creator = "IMDS Tracker";
  const ws = wb.addWorksheet("Outstanding parts", { views: [{ state: "frozen", ySplit: 4 }] });
  ws.getCell("A1").value = safe(`${supplierName} (${supplierCode || "-"})`); ws.getCell("A1").font = { bold: true, size: 14 };
  ws.getCell("A2").value = `Generated ${new Date().toISOString().slice(0, 10)} · ${parts.length} part(s). Please fill in the last column and reply by e-mail.`;
  const withSupplier = parts.some((p) => p.company_name);
  const headers = ["NO.", ...(withSupplier ? ["SUPPLIER"] : []), "PROJECT", "PART NO.", "PART NAME", "PART STATUS", "ID / VER", "STATUS DATE", "SUBMISSION PLAN", "COMMENT", "SUPPLIER PLANNED SUBMISSION DATE (FILL IN)"];
  ws.addTable({
    name: "OutstandingParts", ref: "A4", headerRow: true, totalsRow: false, style: { theme: "TableStyleMedium7", showRowStripes: true },
    columns: headers.map((name) => ({ name })),
    rows: (parts.length ? parts : [{}]).map((p, i) => [parts.length ? i + 1 : "", ...(withSupplier ? [safe((p as XlsxPart).company_name)] : []), safe((p as XlsxPart).project), safe((p as XlsxPart).part_no), safe((p as XlsxPart).part_name), safe((p as XlsxPart).imds_status || "NOT SUBMITTED"), safe((p as XlsxPart).imds_id_version || (p as XlsxPart).md_id_version), safe((p as XlsxPart).md_status_update_date), safe((p as XlsxPart).submission_plan), safe((p as XlsxPart).comment), ""])
  });
  [6, ...(withSupplier ? [30] : []), 12, 22, 34, 18, 18, 14, 16, 30, 34].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.getRow(4).height = 34; ws.getRow(4).alignment = { vertical: "middle", wrapText: true };
  ws.getColumn(headers.length).eachCell({ includeEmpty: false }, (c, r) => { if (r > 4) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF8E1" } }; });
  return Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer);
}
