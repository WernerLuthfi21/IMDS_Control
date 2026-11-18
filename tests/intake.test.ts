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
  it("mass rows: the tolerance class is Toyota's, never asked; outside the buffer → supplier answers A/B up front", () => {
    const h = ["Part No", "IMDS mass (g)", "Drawing Mass (g)", "Mass Tol. Class"];
    const a = analyzeMatrix([h, ["M1", "500", "100", ""]]);
    expect(a.rows[0].ask.map((q) => q.id)).toEqual(["supplierConfirmation"]);
    expect(a.rows[0].ask.some((q) => q.id === "toleranceClass")).toBe(false);
    expect(a.rows[0].predicted).toBe("Mass tolerance range");
    const same = analyzeMatrix([h, ["M1", "100", "100", ""]]);
    expect(same.rows[0].state).toBe("OK");
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


describe("supplier self-check predicts G-CATS errors and asks only what the supplier can confirm", () => {
  const head = ["Delivery Part No.", "Supplier Code", "CAS No.", "Substance Content(%)", "Application ID"];
  it("a CAS on none of Toyota's lists is expected to pass", () => {
    const a = analyzeMatrix([head, ["P1", "5010", "7732-18-5", "1", ""]]);
    expect(a.rows[0]).toMatchObject({ state: "OK", predicted: "" });
  });
  it("Cd / Hg / Cr6+ / Pb CAS numbers are checked under their ELV error type", () => {
    const a = analyzeMatrix([head, ["P1", "5010", "7440-43-9", "0.005", "44"], ["P2", "5010", "7439-92-1", "0.05", "40"]]);
    expect(a.rows.find((r) => r.cas === "7440-43-9")).toMatchObject({ predicted: "ELV (Cd)", state: "OK" });
    expect(a.rows.find((r) => r.cas === "7439-92-1")?.predicted).toBe("ELV (Pb)");
    expect(a.identity.predicted.map((p) => p.errorType)).toEqual(expect.arrayContaining(["ELV (Cd)", "ELV (Pb)"]));
  });
  it("a supplier code missing from the Purchasing master predicts WARP and asks the supplier once per part", () => {
    const a = analyzeMatrix([head, ["P1", "9999", "7732-18-5", "1", ""], ["P1", "9999", "50-00-0", "0.01", ""]]);
    const warp = a.rows.filter((r) => r.family === "warp");
    expect(warp).toHaveLength(1);
    expect(warp[0]).toMatchObject({ state: "ASK", predicted: "WARP Part number" });
    expect(warp[0].ask[0].id).toBe("supplierCodeOk");
    expect(a.identity.suppliers).toEqual([{ code: "9999", inMaster: false, masterName: null, parts: 1, fromAccount: false }]);
    const yes = analyzeMatrix([head, ["P1", "9999", "7732-18-5", "1", ""]], { answers: { [warp[0].key]: { supplierCodeOk: "Y" } } });
    expect(yes.rows.find((r) => r.family === "warp")?.state).toBe("HOLD");
    const no = analyzeMatrix([head, ["P1", "9999", "7732-18-5", "1", ""]], { answers: { [warp[0].key]: { supplierCodeOk: "N" } } });
    expect(no.rows.find((r) => r.family === "warp")).toMatchObject({ state: "NG", comment: "Supplier code is incorrect." });
  });
  it("a registered code raises no WARP; without a code column the account's code is used", () => {
    expect(analyzeMatrix([head, ["P1", "5010", "7732-18-5", "1", ""]]).rows.some((r) => r.family === "warp")).toBe(false);
    const a = analyzeMatrix([["Part No", "CAS No.", "Content %"], ["P9", "7732-18-5", "1"]], { accountSupplierCode: "9999" });
    expect(a.identity.suppliers[0]).toMatchObject({ code: "9999", fromAccount: true, inMaster: false });
    expect(a.rows.some((r) => r.family === "warp" && r.partNo === "P9")).toBe(true);
  });
  it("destination is never asked to the supplier", () => {
    const a = analyzeMatrix([head, ["P1", "5010", "7439-97-6", "0.05", "44"]]);
    expect(a.rows.flatMap((r) => r.ask.map((q) => q.id))).not.toContain("destination");
  });
});

import { runAutoWorkflow } from "@/lib/judgement/auto";
import { extractRowFacts } from "@/lib/judgement/row-facts";
import { familyOfKind } from "@/lib/intake/confirmations";
describe("supplier answers reach Toyota's judgement", () => {
  const facts = extractRowFacts({});
  it("WARP: supplier says the code is wrong → NG; says correct → still Purchasing (HOLD) with the answer in the steps", () => {
    const no = runAutoWorkflow({ errorType: "WARP Part number", facts, supplierCode: "9999", answers: { supplierCodeOk: "N" } });
    expect(no.recommendation).toMatchObject({ state: "NG", comment: "Supplier code is incorrect." });
    const yes = runAutoWorkflow({ errorType: "WARP Part number", facts, supplierCode: "9999", answers: { supplierCodeOk: "Y" } });
    expect(yes.recommendation.state).toBe("HOLD");
    expect(yes.steps.map((s) => s.id)).toContain("warp-supplier");
    expect(runAutoWorkflow({ errorType: "WARP Part number", facts, supplierCode: "9999", answers: { supplierCodeOk: "Y", purchasingWarp: "Y" } }).recommendation.state).toBe("OK");
  });
  it("ELV and WARP confirmations are stored under families the table accepts", () => {
    expect(familyOfKind("elv")).toBe("substance");
    expect(familyOfKind("warp")).toBe("warp");
    expect(familyOfKind("manual")).toBeNull();
  });
});

describe("mixed supplier files", () => {
  it("a row with masses and no CAS is checked as mass even when the sheet has a CAS column", () => {
    const a = analyzeMatrix([["Part No", "CAS No.", "Content %", "IMDS mass (g)", "Drawing Mass (g)"], ["M1", "", "", "130", "100"], ["S1", "7732-18-5", "1", "", ""]]);
    expect(a.rows.find((r) => r.partNo === "M1")).toMatchObject({ family: "mass", predicted: "Mass tolerance range" });
    expect(a.rows.find((r) => r.partNo === "S1")?.state).toBe("OK");
  });
});
