import ExcelJS from "exceljs";
import { Readable } from "node:stream";
import { cleanCell, trimMatrix } from "@/lib/intake/table";
import { detectColumns } from "@/lib/intake/detect";

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return cleanCell(value);
  if (typeof value === "object") {
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
    if ("text" in value && typeof value.text === "string") return cleanCell(value.text);
    if ("richText" in value && Array.isArray(value.richText)) return cleanCell(value.richText.map((x) => x.text).join(""));
  }
  return "";
}

export const LIMITS = { rows: 5000, cols: 60 };

/** Read XLSX/CSV bytes → matrix of the sheet that looks most like a part/CAS/mass table. */
export async function workbookToMatrix(buffer: Buffer, ext: "xlsx" | "csv"): Promise<{ matrix: string[][]; sheetName: string; sheets: string[]; truncated: boolean }> {
  const wb = new ExcelJS.Workbook();
  if (ext === "csv") await wb.csv.read(Readable.from([buffer.toString("utf8")]));
  else await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
  let best: { matrix: string[][]; name: string; score: number; truncated: boolean } | null = null;
  for (const ws of wb.worksheets) {
    if (ws.rowCount < 2) continue;
    const cols = Math.min(ws.columnCount, LIMITS.cols), rows = Math.min(ws.rowCount, LIMITS.rows + 25);
    const m: string[][] = [];
    for (let r = 1; r <= rows; r++) { const row = ws.getRow(r); m.push(Array.from({ length: cols }, (_, c) => cellText(row.getCell(c + 1).value))); }
    const matrix = trimMatrix(m);
    if (matrix.length < 2) continue;
    const d = detectColumns(matrix.slice(0, 60));
    const score = d.confidence * 10 + Object.keys(d.mapping).length + Math.min(matrix.length, 100) / 1000;
    if (!best || score > best.score) best = { matrix, name: ws.name, score, truncated: ws.rowCount > rows || ws.columnCount > cols };
  }
  if (!best) throw new Error("No worksheet with a table of data was found.");
  return { matrix: best.matrix, sheetName: best.name, sheets: wb.worksheets.map((w) => w.name), truncated: best.truncated };
}
