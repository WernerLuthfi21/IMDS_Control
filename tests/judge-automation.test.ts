import { describe, expect, it } from "vitest";
import { runAutoWorkflow } from "@/lib/judgement/auto";
import { extractRowFacts } from "@/lib/judgement/row-facts";
import { fourPhthalateTotal, materialKey } from "@/lib/judgement/material-group";
import { pickConfirmation, type StoredConfirmation } from "@/lib/intake/confirmations";

const blank = extractRowFacts({});
const trail = (r: ReturnType<typeof runAutoWorkflow>) => (r.flow?.trail ?? []).map((t) => `${t.question}=${t.answer}`).join(" | ");

describe("No.9 Not specified substances: the material name answers 'TOYOTA?' both ways", () => {
  it("a TOYOTA material name is OK", () => {
    const r = runAutoWorkflow({ errorType: "Not specified substances", facts: { ...blank, materialName: "SUPPLIED PART (TOYOTA)" } });
    expect(r.recommendation.state).toBe("OK");
  });
  it("any other material name answers No from the row and goes on to the IMDS-Committee question", () => {
    const r = runAutoWorkflow({ errorType: "Not specified substances", facts: { ...blank, materialName: "ED PAINT" } });
    expect(trail(r)).toMatch(/TOYOTA\?=ED PAINT from the row → No/);
    expect(r.flow?.next?.id).toBe("imdsCommittee");
  });
  it("a blank or masked name still asks a person", () => {
    expect(runAutoWorkflow({ errorType: "Not specified substances", facts: { ...blank, materialName: "***" } }).flow?.next?.id).toBe("toyotaPart");
    expect(runAutoWorkflow({ errorType: "Not specified substances", facts: blank }).flow?.next?.id).toBe("toyotaPart");
  });
  it("a person's answer overrides the row", () => {
    const r = runAutoWorkflow({ errorType: "Not specified substances", facts: { ...blank, materialName: "ED PAINT" }, answers: { toyotaPart: "Y" } });
    expect(r.recommendation.state).toBe("OK");
  });
});

describe("No.8 Mass deviation is computed from (A) and (B) in the row", () => {
  const raw = (a: string, b: string) => ({ "(A)Mass [col 23]": a, "(B)Total Matl' Mass(g) [col 24]": b });
  it("more than 1 % of (A) → NG with the G-CATS comment", () => {
    const r = runAutoWorkflow({ errorType: "Mass deviation", facts: extractRowFacts(raw("100", "98.5")) });
    expect(r.recommendation.state).toBe("NG");
    expect(trail(r)).toMatch(/1\.50 % of \(A\)/);
  });
  it("within 1 % → Contact TMC (HOLD), never OK by itself", () => {
    expect(runAutoWorkflow({ errorType: "Mass deviation", facts: extractRowFacts(raw("100", "99.5")) }).recommendation.state).toBe("HOLD");
  });
  it("missing masses still ask", () => {
    expect(runAutoWorkflow({ errorType: "Mass deviation", facts: extractRowFacts(raw("", "99")) }).flow?.next?.id).toBe("massDev1");
  });
});

describe("Phthalates: total of the four CAS in the same material", () => {
  const row = (cas: string, pct: string, extra: Record<string, string> = {}) => ({
    raw: { "CAS No. [col 29]": cas, "Substance Content(%) [col 31]": pct, "Component Part No. [col 21]": "C1", "Material Name [col 26]": "PVC", "Download Date [col 5]": "2026-11-05", "Level [col 20]": "3", "Component Part Name [col 22]": "X", ...extra },
    partNo: "P1", supplierCode: "5001"
  });
  it("sums the rows of the same material only", () => {
    const target = row("117-81-7", "0.05");
    const sum = fourPhthalateTotal(target, [row("84-74-2", "0.03", { "Level [col 20]": "4" }), row("84-74-2", "0.5", { "Material Name [col 26]": "PP" }), row("1336-36-3", "9")]);
    expect(sum).toEqual({ pct: "0.08", rows: 2 });
  });
  it("returns null when a content is masked", () => {
    expect(fourPhthalateTotal(row("117-81-7", "0.05"), [row("84-74-2", "***", { "Level [col 20]": "4" })])).toBeNull();
  });
  it("material key ignores case and spacing", () => {
    expect(materialKey({ "Material Name [col 26]": " pvc " }, "p1", "5001")).toBe(materialKey({ "Material Name [col 26]": "PVC" }, "P1", "5001"));
  });
  it("the flow answers the total question from the sum", () => {
    const facts = { ...blank, cas: "117-81-7", substanceContentPct: "0.05" };
    expect(runAutoWorkflow({ errorType: "Prohibited substance", facts: { ...facts, fourPhthalateTotal: { pct: "0.08", rows: 2 } }, destination: "EU" }).recommendation.state).toBe("OK");
    const over = runAutoWorkflow({ errorType: "Prohibited substance", facts: { ...facts, fourPhthalateTotal: { pct: "0.12", rows: 3 } }, destination: "EU" });
    expect(over.recommendation.state).toBe("HOLD");
    expect(trail(over)).toMatch(/0\.12% \(sum of 3 rows of this material\) → No/);
  });
});

describe("No.21 WARP: the Purchasing master recommends, a person confirms", () => {
  it("a registered code is recommended OK but keeps the Purchasing step open (never auto-final)", () => {
    const r = runAutoWorkflow({ errorType: "WARP Part number", facts: { ...blank, companyName: "PT 3M INDONESIA" }, supplierCode: "5010" });
    expect(r.recommendation.state).toBe("OK");
    expect(r.steps.find((s) => s.id === "warp-purchasing")?.status).toBe("MANUAL");
  });
  it("the supplier saying the code is wrong wins over the master", () => {
    const r = runAutoWorkflow({ errorType: "WARP Part number", facts: { ...blank, companyName: "PT 3M INDONESIA" }, supplierCode: "5010", answers: { supplierCodeOk: "N" } });
    expect(r.recommendation.state).toBe("NG");
  });
  it("Purchasing's answer decides", () => {
    const r = runAutoWorkflow({ errorType: "WARP Part number", facts: blank, supplierCode: "5010", answers: { purchasingWarp: "Y" } });
    expect(r.recommendation.state).toBe("OK");
    expect(r.steps.find((s) => s.id === "warp-purchasing")?.status).toBe("DONE");
  });
});

describe("batched supplier confirmations pick the same row as the single query", () => {
  const all = [
    { supplier_code: "5001", delivery_part_no: "P1", answers: { a: "1" }, submitted_at: "2026-11-20", source_file_name: null, part_key: "P1", family: "substance", cas: "50-00-0" },
    { supplier_code: "5002", delivery_part_no: "P1", answers: { a: "2" }, submitted_at: "2026-11-21", source_file_name: null, part_key: "P1", family: "substance", cas: "50-00-0" },
    { supplier_code: "5001", delivery_part_no: "P1", answers: { a: "3" }, submitted_at: "2026-11-19", source_file_name: null, part_key: "P1", family: "mass", cas: "" }
  ] as unknown as StoredConfirmation[];
  it("matches part, family, CAS and supplier", () => {
    expect(pickConfirmation(all, { supplier_code: "5001", delivery_part_no: "p1" }, "substance", "50-00-0")?.answers).toEqual({ a: "1" });
    expect(pickConfirmation(all, { supplier_code: "5001", delivery_part_no: "P1" }, "mass", "50-00-0")?.answers).toEqual({ a: "3" });
    expect(pickConfirmation(all, { supplier_code: "9999", delivery_part_no: "P1" }, "substance", "50-00-0")).toBeNull();
  });
});
