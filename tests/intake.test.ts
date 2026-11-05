import { describe, expect, it } from "vitest";
import { parseDelimited } from "@/lib/intake/table";
import { detectColumns, casCells, numberText } from "@/lib/intake/detect";
import { analyzeMatrix } from "@/lib/intake/analyze";
import { partKey } from "@/lib/intake/keys";

const tsv = (rows: string[][]) => rows.map((r) => r.join("\t")).join("\n");

describe("table parsing", () => {
  it("reads Excel clipboard text with quoted line breaks", () => {
    const m = parseDelimited('Part No.\tCAS No.\n87910F0670\t"872-50-4\n"\n');
    expect(m[0]).toEqual(["Part No.", "CAS No."]); expect(m[1][0]).toBe("87910F0670"); expect(m[1][1]).toBe("872-50-4");
  });
  it("reads semicolon CSV", () => { expect(parseDelimited("a;b\n1;2")[1]).toEqual(["1", "2"]); });
});

describe("column detection", () => {
  const m = parseDelimited(tsv([["Supplier Code", "Delivery Part No.", "CAS No.", "Substance Content(%)", "Material Name"], ["S01", "87910F0670", "872-50-4", "5", "PA66"], ["S01", "87910F0671", "118-74-1", "0.0001", "PA66"]]));
  it("maps headers with high confidence", () => {
    const d = detectColumns(m);
    expect(d.headerRow).toBe(0); expect(d.mapping.partNo).toBe(1); expect(d.mapping.cas).toBe(2); expect(d.mapping.contentPct).toBe(3);
    expect(d.needsConfirm).toBe(false); expect(d.kinds).toContain("substance");
  });
  it("finds the header row below a title block", () => {
    const d = detectColumns([["Supplier self declaration", "", ""], ["", "", ""], ["Part Number", "CAS", "Content wt%"], ["X1234", "872-50-4", "1"]]);
    expect(d.headerRow).toBe(2); expect(d.mapping.cas).toBe(1);
  });
  it("flags two CAS-like columns instead of merging them", () => {
    const d = detectColumns([["Part No", "CAS No.", "CAS No."], ["A1234", "872-50-4", "118-74-1"]]);
    expect(d.needsConfirm).toBe(true); expect(d.warnings.join(" ")).toMatch(/Duplicate|Two columns/);
  });
  it("has no header → guesses from values and asks to confirm", () => {
    const d = detectColumns([["87910F0670", "872-50-4"], ["87910F0671", "118-74-1"]]);
    expect(d.headerRow).toBeNull(); expect(d.mapping.cas).toBe(1); expect(d.needsConfirm).toBe(true);
  });
  it("mislabeled CAS column lowers confidence", () => {
    const d = detectColumns([["Part No", "CAS No."], ["A1234", "hello"], ["A1235", "world"]]);
    expect(d.columns[1].confidence).toBeLessThan(0.75);
  });
});

describe("cell cleaning", () => {
  it("validates CAS and catches Excel date conversion and typos", () => {
    expect(casCells("872-50-4").cas).toEqual(["872-50-4"]);
    expect(casCells("872-50-5").issue).toMatch(/check digit/);
    expect(casCells("2020-01-02").issue).toMatch(/date/);
    expect(casCells("1336-36-3; 118-74-1").cas).toHaveLength(2);
  });
  it("numbers: %, decimal comma, ppm", () => {
    expect(numberText("0.05%")).toBe("0.05"); expect(numberText("1,5")).toBe("1.5"); expect(numberText("1.325,02")).toBe("1325.02");
    expect(numberText("500", true)).toBe("0.05"); expect(numberText("abc")).toBe("");
  });
  it("part key ignores case/hyphen/space only", () => { expect(partKey("87910-f0670 ")).toBe("87910F0670"); expect(partKey("87910F0671")).not.toBe(partKey("87910F0670")); });
});

describe("analysis", () => {
  const head = ["Delivery Part No.", "CAS No.", "Substance Content(%)"];
  it("pyrrolidones below threshold → OK for any destination", () => {
    const a = analyzeMatrix([head, ["P1", "872-50-4", "0.1"]]);
    expect(a.rows[0].state).toBe("OK"); expect(a.rows[0].comment).toMatch(/below threshold/i);
  });
  it("pyrrolidones above threshold: EU needs supplier answers, non-EU is OK", () => {
    const a = analyzeMatrix([head, ["P1", "872-50-4", "5"]]);
    expect(a.rows[0].state).toBe("ASK"); expect(a.rows[0].ask[0].id).toBe("mfgOutsideEu"); expect(a.rows[0].byDest?.KR).toBe("OK");
  });
  it("answers are applied and become a confirmed result", () => {
    const first = analyzeMatrix([head, ["P1", "872-50-4", "5"]]);
    const key = first.rows[0].key;
    const a = analyzeMatrix([head, ["P1", "872-50-4", "5"]], { answers: { [key]: { mfgOutsideEu: "Y" } } });
    expect(a.rows[0].state).toBe("OK");
  });
  it("destination-dependent result is not guessed", () => {
    const a = analyzeMatrix([["Part No", "CAS", "Content %", "Material Name", "IMDS Matl. Class"], ["D1", "818-08-6", "5", "PA66", "2.1"]], { answers: {} });
    expect(["ASK", "DEPENDS"]).toContain(a.rows[0].state);
  });
  it("invalid CAS never reaches the flow", () => {
    const a = analyzeMatrix([head, ["P1", "872-50-5", "5"]]);
    expect(a.rows[0].state).toBe("INVALID"); expect(a.counts.INVALID).toBe(1);
  });
  it("multiple CAS in one cell become separate rows", () => {
    const a = analyzeMatrix([head, ["P1", "872-50-4; 118-74-1", "0.1"]]);
    expect(a.rows).toHaveLength(2);
  });
  it("mass rows: class missing → asks; outside buffer → asks A/B", () => {
    const h = ["Part No", "IMDS mass (g)", "Drawing Mass (g)", "Mass Tol. Class"];
    const a = analyzeMatrix([h, ["M1", "500", "100", ""]]);
    expect(a.rows[0].ask[0].id).toBe("toleranceClass");
    const b = analyzeMatrix([h, ["M1", "500", "100", "MC"]]);
    expect(b.rows[0].ask[0].id).toBe("supplierConfirmation");
    const c = analyzeMatrix([h, ["M1", "100", "100", "MC"]]);
    expect(c.rows[0].state).toBe("OK");
  });
  it("Error Type 19 column stays HOLD", () => {
    const a = analyzeMatrix([["Part No", "Error Type", "CAS No.", "Content %"], ["P1", "19", "872-50-4", "0.1"]]);
    expect(a.rows[0].state).toBe("HOLD");
  });
  it("handles a large paste quickly", () => {
    const rows = [head]; for (let i = 0; i < 2000; i++) rows.push([`P${i}`, i % 2 ? "872-50-4" : "118-74-1", "0.1"]);
    const t = Date.now(); const a = analyzeMatrix(rows); expect(a.rows).toHaveLength(2000); expect(Date.now() - t).toBeLessThan(5000);
  });
});
