/**
 * Office Script: UpsertRows (Excel → Automate → New script; paste this file; save as "UpsertRows").
 * Power Automate calls it with the standard action "Run script" / "Run script from SharePoint library".
 * That action is not Premium.
 *
 * One call updates or adds a whole batch, instead of List rows + Update a row for every row. It is roughly
 * 50× fewer Excel calls, so you avoid throttling (429) and "file locked" errors.
 *   - Rows are matched by keyColumn (KEY for the Tracker PartMaster table, code for JudgementRegister).
 *   - Only columns present in the incoming row are written; formulas in other columns are kept.
 *   - A key not in the table is added at the bottom. Nothing is ever deleted.
 *   - Leading-zero codes (0005) stay text. Values starting with = + - @ are written as text, never run.
 */
function main(workbook: ExcelScript.Workbook, tableName: string, keyColumn: string, rowsJson: string): string {
  const table = workbook.getTable(tableName);
  if (!table) throw new Error(`Table "${tableName}" was not found in this workbook.`);
  const headers = table.getHeaderRowRange().getValues()[0].map((h: string | number | boolean) => String(h).trim());
  const keyAt = headers.indexOf(keyColumn);
  if (keyAt < 0) throw new Error(`Column "${keyColumn}" was not found in table "${tableName}".`);

  let incoming: Array<Record<string, unknown>> = [];
  const parsed: unknown = JSON.parse(rowsJson || "[]");
  if (Array.isArray(parsed)) incoming = parsed as Array<Record<string, unknown>>;
  else if (parsed && typeof parsed === "object") incoming = [parsed as Record<string, unknown>];

  // Everything is written as Excel would read typed text: "3" becomes a number, "2026-09-30" a date.
  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    const s = String(v);
    if (/^[=+\-@]/.test(s) || /^0\d+$/.test(s)) return "'" + s;
    return s;
  };

  const rowCount = table.getRowCount();
  const body = rowCount > 0 ? table.getRangeBetweenHeaderAndTotal() : null;
  const values = body ? body.getValues() : [];
  const formulas: string[][] = body ? body.getFormulas() : [];
  const index = new Map<string, number>();
  for (let i = 0; i < values.length; i++) {
    const k = String(values[i][keyAt]).trim();
    if (k && !index.has(k)) index.set(k, i);
  }

  let updated = 0, added = 0, skipped = 0;
  const changed = new Set<number>();
  const newRows: string[][] = [];
  const newIndex = new Map<string, number>();
  for (const row of incoming) {
    const key = String(row[keyColumn] ?? "").trim();
    if (!key) { skipped++; continue; }
    const at = index.get(key);
    if (at !== undefined) {
      for (let c = 0; c < headers.length; c++) {
        if (c === keyAt || !(headers[c] in row)) continue;
        formulas[at][c] = cell(row[headers[c]]);
      }
      changed.add(at); updated++;
    } else if (newIndex.has(key)) {
      const r = newRows[newIndex.get(key)!];
      for (let c = 0; c < headers.length; c++) if (headers[c] in row) r[c] = cell(row[headers[c]]);
      updated++;
    } else {
      newIndex.set(key, newRows.length);
      newRows.push(headers.map((h: string) => (h in row ? cell(row[h]) : "")));
      added++;
    }
  }
  // Write back only the rows that changed, one row at a time, so formulas elsewhere are untouched.
  if (body) Array.from(changed).forEach((i) => body.getRow(i).setFormulas([formulas[i]]));
  if (newRows.length) table.addRows(-1, newRows);
  return JSON.stringify({ updated, added, skipped });
}
