/** Turn pasted Excel cells / CSV text into a matrix of strings. Keeps quoted cells with line breaks intact. */
export function parseDelimited(input: string): string[][] {
  const text = input.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const firstLines = text.split("\n").slice(0, 8).join("\n");
  const count = (c: string) => firstLines.split(c).length - 1;
  const delim = count("\t") > 0 ? "\t" : count(";") > count(",") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false, i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i += 2; continue; } quoted = false; i++; continue; }
      cell += ch; i++; continue;
    }
    if (ch === '"' && cell === "") { quoted = true; i++; continue; }
    if (ch === delim) { row.push(cell); cell = ""; i++; continue; }
    if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i++; continue; }
    cell += ch; i++;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return trimMatrix(rows);
}

export function cleanCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).replace(/_x000D_/g, " ").replace(/[ ​]/g, " ").replace(/\s+/g, " ").trim();
}

/** Drop fully empty rows/columns at the edges; keep row order. */
export function trimMatrix(rows: string[][]): string[][] {
  const cleaned = rows.map((r) => r.map(cleanCell));
  const nonEmpty = cleaned.filter((r) => r.some((c) => c !== ""));
  const width = nonEmpty.reduce((m, r) => { let last = r.length; while (last > 0 && r[last - 1] === "") last--; return Math.max(m, last); }, 0);
  return nonEmpty.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ""));
}
