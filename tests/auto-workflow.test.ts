import { describe, expect, it } from "vitest";
import { extractRowFacts } from "@/lib/judgement/row-facts";
import { lookupPbPolicy } from "@/lib/judgement/pb-policy";
import { runAutoWorkflow } from "@/lib/judgement/auto";

const blank = extractRowFacts({});

describe("extractRowFacts", () => {
  it("reads CAS, application and mass fields by header and column, ignoring masked values", () => {
    const f = extractRowFacts({
      "CAS No. [col 29]": "71-55-6", "Substance Name [col 30]": "Confidential Substances", "Application ID [col 32]": "85",
      "Mass(g) [col 19]": "767", "Drawing Mass(g)\nMax [col 33]": "873", "Drawing Mass(g)\nMin [col 34]": "873", "Mass Tol. Class [col 52]": "mc", "Material Name [col 26]": "***"
    });
    expect(f.cas).toBe("71-55-6");
    expect(f.imdsMass).toBe("767");
    expect(f.drawingMass).toBe("873");
    expect(f.toleranceClass).toBe("MC");
    expect(f.materialName).toBe("");
  });
});

describe("lookupPbPolicy", () => {
  it("returns plain OK/NG cells and holds date-flip entries", () => {
    expect(lookupPbPolicy("85", "JP")).toMatchObject({ found: true, outcome: "OK" });
    expect(lookupPbPolicy("70", "EU")).toMatchObject({ found: true, outcome: "NG" });
    expect(lookupPbPolicy("53", "CN")).toMatchObject({ found: true, outcome: "OK" });
    expect(lookupPbPolicy("53", "EU")).toMatchObject({ found: true, outcome: "NG" });
    expect(lookupPbPolicy("79", "JP")).toMatchObject({ found: true, outcome: "HOLD" });
    expect(lookupPbPolicy("71", "EU")).toMatchObject({ found: true, outcome: "HOLD" });
  });
  it("asks for missing input instead of guessing", () => {
    expect(lookupPbPolicy("", "EU").found).toBe(false);
    expect(lookupPbPolicy("85", "").found).toBe(false);
    expect(lookupPbPolicy("999", "EU").found).toBe(false);
  });
});

describe("runAutoWorkflow", () => {
  it("mass tolerance needs only the class and then evaluates automatically", () => {
    const facts = { ...blank, imdsMass: "100", drawingMass: "100" };
    const before = runAutoWorkflow({ errorType: "Mass tolerance range", facts });
    expect(before.needs.toleranceClass).toBe(true);
    expect(before.recommendation.state).toBe("HOLD");
    const after = runAutoWorkflow({ errorType: "Mass tolerance range", facts, toleranceClass: "MC" });
    expect(after.needs.toleranceClass).toBe(false);
    expect(after.recommendation.state).toBe("OK");
    expect(after.massBands).not.toBeNull();
    expect(after.procedureText).toContain("TSZ2900G");
  });
  it("outside the 10% buffer asks for supplier A/B instead of deciding", () => {
    const r = runAutoWorkflow({ errorType: "Mass tolerance range", facts: { ...blank, imdsMass: "500", drawingMass: "100" }, toleranceClass: "MC" });
    expect(r.recommendation.state).toBe("HOLD");
    expect(r.needs.supplierConfirmation).toBe(true);
  });
  it("prohibited substance: CAS → GADSL → TSZ group → flow run automatically and fill the procedure text", () => {
    const r = runAutoWorkflow({ errorType: "Prohibited substance", facts: { ...blank, cas: "71-55-6" } });
    expect(r.steps.find((s) => s.id === "gadsl")?.status).toBe("DONE");
    expect(r.steps.find((s) => s.id === "tsz")?.status).toBe("DONE");
    expect(r.procedureText).toMatch(/TSZ0001G/);
    expect(r.needs.destination).toBe(true);
    expect(r.recommendation.state).toBe("HOLD");
  });
  it("masked CAS is routed to manual search", () => {
    const r = runAutoWorkflow({ errorType: "Prohibited substance", facts: blank });
    expect(r.steps.find((s) => s.id === "gadsl")?.status).toBe("MANUAL");
  });
  it("ELV (Pb): application ID + destination gives a recommendation from the policy table", () => {
    const ok = runAutoWorkflow({ errorType: "ELV (Pb)", facts: { ...blank, cas: "7439-92-1", applicationId: "85" }, destination: "JP" });
    expect(ok.recommendation.state).toBe("OK");
    const ng = runAutoWorkflow({ errorType: "ELV (Pb)", facts: { ...blank, cas: "7439-92-1", applicationId: "70" }, destination: "EU" });
    expect(ng.recommendation.state).toBe("HOLD");
    expect(ng.steps.find((s) => s.id === "dest")?.detail).toMatch(/NG/);
  });
  it("never produces OK/NG for unmapped manual error types", () => {
    expect(runAutoWorkflow({ errorType: "Part number", facts: blank }).recommendation.state).toBe("HOLD");
  });
});

describe("GADSL numbering", () => {
  it("falls back to the reference number when the GADSL number cell is merged/blank", () => {
    const r = runAutoWorkflow({ errorType: "Prohibited substance", facts: { ...blank, cas: "71-55-6" } });
    expect(r.procedureText).toMatch(/GADSL: \d+/);
  });
});
