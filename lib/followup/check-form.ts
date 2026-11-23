// "IMDS Supplier Check Form", generated per supplier and attached to follow-up e-mails. Same four sheets as the
// TMMIN-ME form (guide, checking list, information form, contact person), with what TMMIN already knows filled in:
// supplier code, company, every outstanding part (number, name, model, ID/version, plan date), the findings G-CATS
// recorded for that part number before, and the current contacts. Excel formulas check the supplier's own entries
// (mass deviation must be 0, Misc. < 10 %, actual mass inside the drawing tolerance, prohibited substance explained)
// so errors show before the data is submitted. Generated on demand, never stored.
import ExcelJS from "exceljs";
import { cleanCell } from "@/lib/imds-master/clean-cell";

export type CheckFormPart = { part_no?: string | null; part_name?: string | null; project?: string | null; imds_id_version?: string | null; md_id_version?: string | null; submission_plan?: string | null; imds_status?: string | null };
export type CheckFormContact = { role: string; name?: string; division?: string; email?: string; phone?: string };
export type CheckFormInput = { supplierName: string; supplierCode: string; parts: CheckFormPart[]; findings?: Record<string, string[]>; contacts?: CheckFormContact[]; generatedAt?: Date };

const safe = (v: unknown) => { const s = cleanCell(v); return /^[=+\-@\t\r]/.test(s) ? "'" + s : s; };
export const partKey = (p: unknown) => String(p ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
/** Toyota IMDS supplier code: region Z008 + 4-digit vendor code. Left empty when the vendor code is not 4 characters. */
export const imdsSupplierCode = (code: string) => (/^[A-Z0-9]{4}$/i.test(code.trim()) ? "Z008" + code.trim().toUpperCase() : "");

const C = { ink: "FF1F2937", head: "FF4C1D95", headInk: "FFFFFFFF", band: "FFEDE9FE", fill: "FFFFF8E1", known: "FFF3F4F6", ok: "FFDCFCE7", okInk: "FF166534", bad: "FFFEE2E2", badInk: "FF991B1B", line: "FFD1D5DB" };
const border: Partial<ExcelJS.Borders> = { top: { style: "thin", color: { argb: C.line } }, left: { style: "thin", color: { argb: C.line } }, bottom: { style: "thin", color: { argb: C.line } }, right: { style: "thin", color: { argb: C.line } } };
const solid = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });

const GUIDE: [string, string][] = [
  ["OBJECTIVE", ""],
  ["", "IMDS Supplier Check Form helps both suppliers and TMMIN to verify the completeness, accuracy, and compliance of IMDS/MDS data submission."],
  ["", "IMDS Supplier Check Form aims to minimize IMDS data errors, rejections, and repeated clarification between suppliers and TMMIN-ME."],
  ["", "Suppliers are requested to fill in a self-check of each part number (Mass Information, Prohibited Substance Declaration, Material Information) based on the requirements in this guide, and to complete the IMDS Checking List and the IMDS Information Form before submitting IMDS data, in order to prevent data errors."],
  ["GENERAL INSTRUCTIONS", ""],
  ["", "1. Review each item in “1. IMDS Checking List” and make sure all data is correct before submitting the Delivery Part to the MDS System."],
  ["", "2. Fill in the mass, material and substance information in “2. IMDS Information Form”. Your parts are already listed. The AUTO CHECK column turns red when an entry does not meet the requirements."],
  ["", "3. If any prohibited substance is used, note its purpose of use and reason (impurity, intentional, reaction result, or remains in the final product)."],
  ["", "4. If a requirement is not met or clarification is needed, explain it in the remarks."],
  ["", "5. Please confirm or update the IMDS contact persons in “3. Contact Person (Updated)”."],
  ["", "6. After completing this form and submitting the IMDS data through the system, notify the TMMIN IMDS PIC and send this form by e-mail for further judgement."],
  ["ITEMS TO CHECK", ""],
  ["1. Part Number & Part Name", "Ensure that the part number and part name are correct and consistent with the actual part information."],
  ["2. Supplier Code", "Verify that the supplier information is correct, including both the Region Code (Z008) and the Supplier Code."],
  ["3. Delivery Part Weight", "Provide the actual measured weight of the delivery part and the drawing mass, and verify that it is within the minimum and maximum mass tolerance."],
  ["4. Mass Deviation", "Ensure that the mass deviation is 0 % in accordance with TMMIN requirements. Any deviation results in NG."],
  ["5. Application ID for Pb, Cd and Hg", "(If the part contains Pb, Cd or Hg) Verify that the correct Application ID is selected for lead (Pb), cadmium (Cd) and mercury (Hg), and that the application purpose is correctly specified."],
  ["6. Not Specified Substances / Misc.", "Ensure that the total content of Not Specified Substances is less than 10 % by weight."],
  ["7. Material Data Structure", "Ensure that paint, adhesive, sealant and galvanized steel sheet are broken down into their constituent sub-materials."],
  ["8. IMDS Data Structure", "Check that the Component, Material and Substance levels are correctly defined and declared."],
  ["9. Prohibited Substance", "If prohibited substances are present, provide the substance information and clarify the reason for their presence, and whether the substance remains in the final product."],
  ["PREVIOUS G-CATS FINDINGS", "Column AC of the Information Form lists what G-CATS recorded for the same part number in earlier submissions. Please check these points first."]
];

const CHECKS: [string, string, string][] = [
  ["IMDS SUBMISSION INFORMATION", "SUPPLIER CODE", "Z008 + 4-digit supplier code"], ["", "COMPANY NAME", ""], ["", "PART NUMBER", "10-digit part number"], ["", "PART NAME", ""], ["", "LATEST ECI NO.", ""], ["", "ID / VERSION", "Module ID in the IMDS system"],
  ["MASS INFORMATION", "(A) Mass (g)", "Mass input in IMDS"], ["", "(B) Total Mass (g)", "Total mass input in IMDS"], ["", "Mass Deviation (A − B) (g)", "Must be zero (0 %)"], ["", "Drawing Mass MAX / MIN (g)", "Based on drawing (min–max tolerance)"], ["", "Actual Mass MAX / MIN (g)", "Based on actual measured weight (min–max tolerance)"], ["", "Mass Tolerance Class", "MA, MB, MC, MD, ME or MF"], ["", "IMDS data structure", "Component, material and substance levels"],
  ["MATERIAL INFORMATION", "Material", "Paint, adhesive, sealant and galvanized steel sheet broken down into sub-materials"], ["", "Misc. (Not Specified Substance)", "Less than 10 % by weight"],
  ["APPLICATION ID & PROHIBITED SUBSTANCE", "Correct Application ID (Pb, Cd, Hg)", "Application ID correct for Pb, Cd, Hg"], ["", "Prohibited Substance Clarification", "Substance name, % content, purpose of use, remains in final product or not"]
];

// Information form columns (A … AD). A–AA follow the TMMIN-ME form; AB–AD are added by the Tracker.
const COLS: [string, number, "known" | "fill" | "auto"][] = [
  ["NO.", 6, "known"], ["SUPPLIER CODE", 13, "known"], ["COMPANY NAME", 24, "known"], ["PART NUMBER", 16, "known"], ["PART NAME", 30, "known"], ["LATEST ECI NO.", 14, "fill"], ["ID / VERSION", 16, "fill"], ["SUBMISSION DATE", 14, "fill"],
  ["(A) MASS (g)", 11, "fill"], ["(B) TOTAL MASS (g)", 12, "fill"], ["MASS DEVIATION (A − B) (g)", 13, "auto"], ["DRAWING MASS max (g)", 12, "fill"], ["DRAWING MASS min (g)", 12, "fill"], ["ACTUAL MASS max (g)", 12, "fill"], ["ACTUAL MASS min (g)", 12, "fill"], ["MASS TOLERANCE CLASS", 11, "fill"], ["Supplier remarks / explanation", 24, "fill"],
  ["MATERIAL NAME", 22, "fill"], ["Misc. / Not Specified Substance (% wt)", 13, "fill"], ["Supplier remarks / explanation", 24, "fill"],
  ["CORRECT APPLICATION ID (if Pb, Cd, Hg)", 14, "fill"], ["SUBSTANCE NAME", 22, "fill"], ["CAS No.", 13, "fill"], ["SUBSTANCE CONTENT (%)", 12, "fill"], ["REMAINS IN FINAL PRODUCT", 18, "fill"], ["PURPOSE OF USE", 20, "fill"], ["Supplier remarks / explanation", 24, "fill"],
  ["AUTO CHECK (do not edit)", 34, "auto"], ["PREVIOUS G-CATS FINDINGS FOR THIS PART (TMMIN)", 40, "known"], ["MODEL · PLAN DATE (TMMIN)", 18, "known"]
];

/** The AUTO CHECK formula for one row: empty → "Not filled yet", every problem listed, else "OK". */
export function autoCheckFormula(r: number): string {
  const problems = [
    `IF(AND(I${r}<>"",J${r}<>"",K${r}<>0),"Mass deviation is not 0; ","")`,
    `IF(AND(S${r}<>"",S${r}>=10),"Misc. 10 % or more; ","")`,
    `IF(AND(N${r}<>"",L${r}<>"",N${r}>L${r}),"Actual max above drawing max; ","")`,
    `IF(AND(O${r}<>"",M${r}<>"",O${r}<M${r}),"Actual min below drawing min; ","")`,
    `IF(AND(I${r}<>"",L${r}<>"",M${r}<>"",OR(I${r}>L${r},I${r}<M${r})),"IMDS mass outside drawing tolerance; ","")`,
    `IF(AND(V${r}<>"",OR(Y${r}="",Z${r}="")),"Prohibited substance: fill remains / purpose; ","")`,
    `IF(AND(I${r}<>"",G${r}=""),"ID / Version missing; ","")`
  ].join("&");
  return `IF(AND(I${r}="",J${r}="",R${r}="",V${r}=""),"Not filled yet",IF((${problems})="","OK",${problems}))`;
}

export async function buildCheckFormXlsx(i: CheckFormInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook(); wb.creator = "IMDS Tracker"; wb.created = i.generatedAt || new Date();
  const company = safe(i.supplierName), code = cleanCell(i.supplierCode), zcode = imdsSupplierCode(code);
  const stamp = (i.generatedAt || new Date()).toISOString().slice(0, 10);

  // ---- Guide
  const g = wb.addWorksheet("Guide & Instruction", { properties: { tabColor: { argb: C.head } }, views: [{ showGridLines: false }] });
  g.getColumn(1).width = 34; g.getColumn(2).width = 110;
  g.mergeCells("A1:B1"); g.getCell("A1").value = "GUIDE & INSTRUCTIONS"; g.getCell("A1").font = { bold: true, size: 16, color: { argb: C.headInk } }; g.getCell("A1").fill = solid(C.head); g.getRow(1).height = 28;
  g.mergeCells("A2:B2"); g.getCell("A2").value = `${company} (${code || "-"}) · generated by TMMIN Material Engineering on ${stamp} · ${i.parts.length} part(s) listed`; g.getCell("A2").font = { italic: true, color: { argb: C.ink } };
  let row = 4;
  for (const [h, t] of GUIDE) {
    if (h && !t) { g.mergeCells(`A${row}:B${row}`); const c = g.getCell(`A${row}`); c.value = h; c.font = { bold: true, size: 12, color: { argb: C.head } }; c.fill = solid(C.band); row++; continue; }
    if (h) { g.getCell(`A${row}`).value = h; g.getCell(`A${row}`).font = { bold: true }; g.getCell(`B${row}`).value = t; }
    else { g.mergeCells(`A${row}:B${row}`); g.getCell(`A${row}`).value = t; }
    g.getRow(row).alignment = { wrapText: true, vertical: "top" }; g.getRow(row).height = Math.max(18, Math.ceil(t.length / 120) * 16); row++;
  }

  // ---- 1. Checking list
  const k = wb.addWorksheet("1. IMDS Checking List", { views: [{ showGridLines: false, state: "frozen", ySplit: 3 }] });
  [30, 34, 56, 16].forEach((w, n) => { k.getColumn(n + 1).width = w; });
  k.mergeCells("A1:D1"); k.getCell("A1").value = `IMDS CHECKING LIST — ${company}`; k.getCell("A1").font = { bold: true, size: 14, color: { argb: C.headInk } }; k.getCell("A1").fill = solid(C.head); k.getRow(1).height = 26;
  k.mergeCells("A2:D2"); k.getCell("A2").value = "Please review each item and set STATUS to “Checked” once the requirement is fulfilled and correct."; k.getCell("A2").font = { italic: true };
  const kh = k.getRow(3); ["ITEM TO CHECK", "", "INFORMATION", "STATUS"].forEach((t, n) => { const c = kh.getCell(n + 1); c.value = t; c.font = { bold: true, color: { argb: C.headInk } }; c.fill = solid(C.head); c.border = border; });
  CHECKS.forEach(([grp, item, info], n) => {
    const r = k.getRow(4 + n);
    r.getCell(1).value = grp; r.getCell(2).value = item; r.getCell(3).value = info; r.getCell(4).value = "Not checked";
    r.getCell(1).font = { bold: true, color: { argb: C.head } };
    for (let c = 1; c <= 4; c++) { r.getCell(c).border = border; r.getCell(c).alignment = { wrapText: true, vertical: "middle" }; }
    r.getCell(4).fill = solid(C.fill);
    r.getCell(4).dataValidation = { type: "list", allowBlank: false, formulae: ['"Checked,Not checked,Not applicable"'] };
  });
  if (zcode) { k.getCell("C4").value = `${zcode} (${code})`; }
  k.getCell("C5").value = company;
  const last = 3 + CHECKS.length;
  k.addConditionalFormatting({ ref: `D4:D${last}`, rules: [
    { type: "containsText", operator: "containsText", text: "Not checked", priority: 1, style: { fill: solid(C.bad), font: { color: { argb: C.badInk } } } },
    { type: "containsText", operator: "containsText", text: "Checked", priority: 2, style: { fill: solid(C.ok), font: { color: { argb: C.okInk } } } }
  ] });

  // ---- 2. Information form
  const f = wb.addWorksheet("2. IMDS Information Form", { views: [{ state: "frozen", ySplit: 7, xSplit: 5 }] });
  COLS.forEach(([, w], n) => { f.getColumn(n + 1).width = w; });
  f.mergeCells("A1:J1"); f.getCell("A1").value = `IMDS INFORMATION FORM — ${company}`; f.getCell("A1").font = { bold: true, size: 14, color: { argb: C.headInk } }; f.getCell("A1").fill = solid(C.head); f.getRow(1).height = 26;
  f.mergeCells("A2:Q2"); f.getCell("A2").value = "Please complete all required information to support IMDS judgement by TMMIN-ME. Grey = filled by TMMIN, yellow = please fill in, AUTO CHECK shows problems before you submit. Explain anything that does not meet the requirements in the remarks.";
  f.getCell("A2").alignment = { wrapText: true }; f.getRow(2).height = 32;
  f.getCell("A3").value = `Supplier: ${company} · Code: ${code || "-"}${zcode ? " · IMDS supplier code " + zcode : ""} · ${i.parts.length} part(s) · generated ${stamp}`; f.getCell("A3").font = { bold: true };
  const groups: [string, string, string][] = [["A5", "H5", "IMDS SUBMISSION INFORMATION"], ["I5", "Q5", "MASS INFORMATION"], ["R5", "T5", "MATERIAL INFORMATION"], ["U5", "AA5", "APPLICATION ID & PROHIBITED SUBSTANCE"], ["AB5", "AD5", "TMMIN CHECK & HISTORY"]];
  for (const [a, b, t] of groups) { f.mergeCells(`${a}:${b}`); const c = f.getCell(a); c.value = t; c.font = { bold: true, color: { argb: C.headInk } }; c.fill = solid(C.head); c.alignment = { horizontal: "center" }; }
  const hr = f.getRow(7); hr.height = 48;
  COLS.forEach(([t, , kind], n) => { const c = hr.getCell(n + 1); c.value = t; c.font = { bold: true, color: { argb: C.ink } }; c.fill = solid(kind === "fill" ? C.fill : C.band); c.border = border; c.alignment = { wrapText: true, vertical: "middle", horizontal: "center" }; });
  f.getRow(6).getCell(1).value = "Grey cells: TMMIN data · Yellow: please fill in · AUTO CHECK: computed";
  f.getRow(6).getCell(1).font = { italic: true, size: 9 };

  const parts = i.parts.length ? i.parts : [{} as CheckFormPart];
  parts.forEach((p, n) => {
    const r = 8 + n, x = f.getRow(r);
    const finds = (i.findings || {})[partKey(p.part_no)] || [];
    const vals: unknown[] = [i.parts.length ? n + 1 : "", zcode || code, company, safe(p.part_no), safe(p.part_name), "", safe(p.imds_id_version || p.md_id_version), "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""];
    vals.forEach((v, c) => { x.getCell(c + 1).value = v as ExcelJS.CellValue; });
    x.getCell(11).value = { formula: `IF(AND(I${r}<>"",J${r}<>""),I${r}-J${r},"")` };
    x.getCell(28).value = { formula: autoCheckFormula(r) };
    x.getCell(29).value = finds.length ? safe(finds.join("\n")) : "No earlier finding recorded";
    x.getCell(30).value = safe([p.project, p.submission_plan ? "plan " + String(p.submission_plan).slice(0, 10) : ""].filter(Boolean).join(" · "));
    COLS.forEach(([, , kind], c) => {
      const cell = x.getCell(c + 1); cell.border = border; cell.alignment = { wrapText: true, vertical: "top" };
      cell.fill = solid(kind === "fill" ? C.fill : kind === "known" ? C.known : "FFFFFFFF");
    });
    for (const col of ["I", "J", "L", "M", "N", "O", "S", "X"]) f.getCell(`${col}${r}`).dataValidation = { type: "decimal", operator: "greaterThanOrEqual", allowBlank: true, formulae: [0], showErrorMessage: true, errorTitle: "Number only", error: "Enter a number (grams or %)." };
    f.getCell(`H${r}`).dataValidation = { type: "date", operator: "greaterThan", allowBlank: true, formulae: [new Date(2020, 0, 1)], showErrorMessage: true, error: "Enter a date." };
    f.getCell(`H${r}`).numFmt = "dd-mmm-yyyy";
    f.getCell(`P${r}`).dataValidation = { type: "list", allowBlank: true, formulae: ['"MA,MB,MC,MD,ME,MF"'] };
    f.getCell(`Y${r}`).dataValidation = { type: "list", allowBlank: true, formulae: ['"Yes remain in final product,Not remain in final product,Input mistake"'] };
    if (finds.length) x.getCell(29).font = { color: { argb: C.badInk } };
  });
  const lastRow = 7 + parts.length;
  f.addConditionalFormatting({ ref: `AB8:AB${lastRow}`, rules: [
    { type: "containsText", operator: "containsText", text: "Not filled", priority: 1, style: { font: { color: { argb: "FF6B7280" } } } },
    { type: "expression", formulae: [`AB8="OK"`], priority: 2, style: { fill: solid(C.ok), font: { bold: true, color: { argb: C.okInk } } } },
    { type: "expression", formulae: [`AND(AB8<>"OK",LEFT(AB8,10)<>"Not filled")`], priority: 3, style: { fill: solid(C.bad), font: { bold: true, color: { argb: C.badInk } } } }
  ] });
  f.addConditionalFormatting({ ref: `K8:K${lastRow}`, rules: [{ type: "expression", formulae: [`AND(K8<>"",K8<>0)`], priority: 4, style: { fill: solid(C.bad), font: { color: { argb: C.badInk } } } }] });
  f.addConditionalFormatting({ ref: `S8:S${lastRow}`, rules: [{ type: "expression", formulae: [`AND(S8<>"",S8>=10)`], priority: 5, style: { fill: solid(C.bad), font: { color: { argb: C.badInk } } } }] });
  f.autoFilter = { from: { row: 7, column: 1 }, to: { row: lastRow, column: COLS.length } };

  // ---- 3. Contact person
  const p3 = wb.addWorksheet("3. Contact Person (Updated)", { views: [{ showGridLines: false }] });
  [22, 28, 24, 34, 20, 30].forEach((w, n) => { p3.getColumn(n + 1).width = w; });
  p3.mergeCells("A1:F1"); p3.getCell("A1").value = "SUPPLIER CONTACT PERSON (UPDATED)"; p3.getCell("A1").font = { bold: true, size: 14, color: { argb: C.headInk } }; p3.getCell("A1").fill = solid(C.head); p3.getRow(1).height = 26;
  p3.mergeCells("A2:F2"); p3.getCell("A2").value = "Please confirm or correct the contacts TMMIN has on file for IMDS (grey = current data). Write the change in the last column or overwrite the cell."; p3.getCell("A2").alignment = { wrapText: true }; p3.getRow(2).height = 30;
  const h3 = p3.getRow(4); ["ROLE", "NAME", "DIVISION / POSITION", "EMAIL", "PHONE / WA", "CHANGE / REMARK"].forEach((t, n) => { const c = h3.getCell(n + 1); c.value = t; c.font = { bold: true, color: { argb: C.headInk } }; c.fill = solid(C.head); c.border = border; });
  const contacts = i.contacts && i.contacts.length ? i.contacts : [{ role: "PIC #1" }, { role: "PIC #2" }, { role: "Top Management" }];
  contacts.forEach((c, n) => {
    const r = p3.getRow(5 + n);
    [c.role, safe(c.name), safe(c.division), safe(c.email), safe(c.phone), ""].forEach((v, m) => { const cell = r.getCell(m + 1); cell.value = v; cell.border = border; cell.fill = solid(m === 5 ? C.fill : m === 0 ? C.band : C.known); cell.alignment = { wrapText: true, vertical: "top" }; });
    r.getCell(1).font = { bold: true };
  });
  const extra = 5 + contacts.length;
  for (let n = 0; n < 3; n++) { const r = p3.getRow(extra + n); ["New contact", "", "", "", "", ""].forEach((v, m) => { const cell = r.getCell(m + 1); cell.value = v; cell.border = border; cell.fill = solid(m === 0 ? C.band : C.fill); }); }

  // Print: every sheet one page wide (A4; the information form in landscape).
  for (const ws of wb.worksheets) ws.pageSetup = { paperSize: 9, orientation: ws === g || ws === k ? "portrait" : "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
  f.pageSetup.printTitlesRow = "7:7";
  return Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer);
}
