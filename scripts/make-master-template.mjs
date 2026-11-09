// Builds the EMPTY Super Master workbook (headers only, no data) used as the SharePoint base for the Tracker.
// Usage: node scripts/make-master-template.mjs <output.xlsx>
import ExcelJS from "exceljs";
const out = process.argv[2] || "IMDS_Super_Master_TEMPLATE.xlsx";
const HEADERS = ["NO.", "PROJECT", "VENDOR CODE", "MAIN PIC EMAIL", "COMPANY NAME", "PART NAME", "PART NO.", "SUBMISSION PLAN", "PART STATUS", "ID / VER", "STATUS DATE", "COMMENT", "KEY"];
const wb = new ExcelJS.Workbook(); wb.creator = "IMDS Tracker";
const s = wb.addWorksheet("Part List LATEST", { views: [{ state: "frozen", ySplit: 6, xSplit: 7 }] });
s.getCell("A1").value = "IMDS SUPER MASTER"; s.getCell("A1").font = { bold: true, size: 14, color: { argb: "FF14532D" } };
s.getCell("A2").value = "Shared with the IMDS Tracker website. Do not rename the columns or the table PartMaster; do not edit the hidden KEY column.";
s.getCell("A3").value = "PART STATUS (ACCEPTED / TMMIN WORKING / REJECTED / NOT SUBMITTED) and ID / VER, STATUS DATE, COMMENT are updated automatically from each MD System upload.";
s.addTable({ name: "PartMaster", ref: "A6", headerRow: true, totalsRow: false, style: { theme: "TableStyleMedium7", showRowStripes: true }, columns: HEADERS.map((name) => ({ name })), rows: [HEADERS.map(() => "")] });
[7, 12, 14, 30, 34, 30, 20, 16, 18, 18, 14, 34, 40].forEach((w, i) => { s.getColumn(i + 1).width = w; });
s.getRow(6).height = 30; s.getRow(6).alignment = { vertical: "middle", wrapText: true };
s.getRow(7).getCell(HEADERS.indexOf("PART STATUS") + 1).dataValidation = { type: "list", allowBlank: true, formulae: ['"ACCEPTED,TMMIN WORKING,REJECTED,NOT SUBMITTED,DEAD (NEW SMS),NOT TO BE COLLECTED"'], showErrorMessage: false };
for (const n of ["SUBMISSION PLAN", "STATUS DATE"]) s.getColumn(HEADERS.indexOf(n) + 1).numFmt = "yyyy-mm-dd";
s.getColumn(HEADERS.indexOf("KEY") + 1).hidden = true;
await wb.xlsx.writeFile(out); console.log("written", out);
