import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Run the real Office Script (docs/power-automate/UpsertRows.ts) against a small in-memory table.
type Cell = string | number | boolean;
function load() {
  const src = readFileSync("docs/power-automate/UpsertRows.ts", "utf8");
  const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  return new Function(`${js}; return main;`)() as (wb: unknown, t: string, k: string, rows: string) => string;
}
function workbook(headers: string[], rows: Cell[][]) {
  const data = rows.map((r) => [...r]);
  const table = {
    getHeaderRowRange: () => ({ getValues: () => [headers] }),
    getRowCount: () => data.length,
    getRangeBetweenHeaderAndTotal: () => ({
      getValues: () => data.map((r) => r.map((c) => (typeof c === "string" && c.startsWith("=") ? "computed" : c))),
      getFormulas: () => data.map((r) => [...r]),
      getRow: (i: number) => ({ setFormulas: (v: Cell[][]) => { data[i] = [...v[0]]; } })
    }),
    addRows: (_: number, v: Cell[][]) => { data.push(...v.map((r) => [...r])); }
  };
  return { wb: { getTable: (n: string) => (n === "PartMaster" ? table : undefined) }, data };
}

describe("Office Script UpsertRows", () => {
  const main = load();
  const headers = ["NO.", "VENDOR CODE", "PART STATUS", "STATE", "KEY"];
  it("updates by key, adds unknown keys, keeps formulas and leading zeros, never deletes", () => {
    const { wb, data } = workbook(headers, [[1, "5022", "TMMIN WORKING", "=IF(C2=1,1,0)", "k1"], [2, "5010", "NOT SUBMITTED", "=IF(C3=1,1,0)", "k2"]]);
    const out = JSON.parse(main(wb, "PartMaster", "KEY", JSON.stringify([
      { KEY: "k2", "PART STATUS": "ACCEPTED" },
      { KEY: "k3", "NO.": 3, "VENDOR CODE": "0005", "PART STATUS": "=cmd()" },
      { KEY: "", "PART STATUS": "x" }
    ])));
    expect(out).toEqual({ updated: 1, added: 1, skipped: 1 });
    expect(data[0]).toEqual([1, "5022", "TMMIN WORKING", "=IF(C2=1,1,0)", "k1"]);
    expect(data[1]).toEqual([2, "5010", "ACCEPTED", "=IF(C3=1,1,0)", "k2"]);
    expect(data[2]).toEqual(["3", "'0005", "'=cmd()", "", "k3"]);
  });
  it("accepts a single object (the Judgement Register flow sends one row) and the same new key twice", () => {
    const { wb, data } = workbook(["code", "Judge OK/NG"], []);
    expect(JSON.parse(main({ getTable: () => (wb as { getTable: (n: string) => unknown }).getTable("PartMaster") }, "PartMaster", "code", JSON.stringify({ code: "code:1", "Judge OK/NG": "OK" })))).toEqual({ updated: 0, added: 1, skipped: 0 });
    expect(data).toEqual([["code:1", "OK"]]);
    const two = workbook(["code", "Judge OK/NG"], []);
    main({ getTable: () => (two.wb as { getTable: (n: string) => unknown }).getTable("PartMaster") }, "X", "code", JSON.stringify([{ code: "a", "Judge OK/NG": "OK" }, { code: "a", "Judge OK/NG": "NG" }]));
    expect(two.data).toEqual([["a", "NG"]]);
  });
  it("explains a wrong table or key column", () => {
    const { wb } = workbook(headers, []);
    expect(() => main(wb, "Nope", "KEY", "[]")).toThrow(/Table "Nope"/);
    expect(() => main(wb, "PartMaster", "MasterKey", "[]")).toThrow(/Column "MasterKey"/);
  });
});
