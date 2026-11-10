import { describe, expect, it } from "vitest";
import { extractRowFacts } from "@/lib/judgement/row-facts";
import { lookupPbPolicy } from "@/lib/judgement/pb-policy";
import { runAutoWorkflow, detectKind } from "@/lib/judgement/auto";

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
    expect(r.flow).toBeTruthy();
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

import { runAutoWorkflow as run2 } from "@/lib/judgement/auto";
import { extractRowFacts as facts2 } from "@/lib/judgement/row-facts";
describe("substance flows (Appendix II)", () => {
  const row = (cas: string, extra: Record<string, unknown> = {}) => facts2({ "CAS No. [col 29]": cas, "Substance Content(%) [col 31]": "5", ...extra });
  it("pyrrolidones non-EU → OK non-regulated", () => {
    const r = run2({ errorType: "Prohibited substance (Pyrrolidones, selected)", facts: row("872-50-4"), destination: "KR" });
    expect(r.recommendation.state).toBe("OK"); expect(r.recommendation.comment).toMatch(/non-Regulated/);
  });
  it("pyrrolidones asks destination first", () => {
    const r = run2({ errorType: "Prohibited substance", facts: row("872-50-4") });
    expect(r.flow?.next?.id).toBe("destination"); expect(r.recommendation.state).toBe("HOLD");
  });
  it("DBT EU with content over 0.1 and non-6.1 material → NG", () => {
    const r = run2({ errorType: "Prohibited substance (DBT)", facts: row("818-08-6", { "IMDS Matl. Class. [col 27]": "2.1", "Material Name [col 26]": "PA66" }), destination: "EU", answers: { lacquer: "N" } });
    expect(r.recommendation.state).toBe("NG");
  });
  it("PCB flow never auto-OKs without supplier answer", () => {
    const r = run2({ errorType: "Prohibited substance", facts: row("1336-36-3") });
    expect(r.recommendation.state).toBe("HOLD"); expect(r.flow?.next?.id).toBe("intent");
  });
  it("unencoded family stays HOLD with PDF page", () => {
    const r = run2({ errorType: "Prohibited substance", facts: row("1303-28-2") });
    expect(r.recommendation.state).toBe("HOLD"); expect(r.flow?.implemented).toBe(false); expect(r.flow?.page).toBe(55);
  });
  it("Error Type 19 is always HOLD", () => {
    const r = run2({ errorType: "19", facts: row("872-50-4"), destination: "KR" });
    expect(r.recommendation.state).toBe("HOLD");
  });
});

describe("more Appendix II flows", () => {
  const row = (cas: string, extra: Record<string, unknown> = {}) => facts2({ "CAS No. [col 29]": cas, "Substance Content(%) [col 31]": "1", ...extra });
  it("Cl paraffins: 1% is above 0.15% → NG", () => {
    const r = run2({ errorType: "Prohibited substance(SCCP)", facts: row("85681-73-8") });
    expect(r.recommendation.state).toBe("NG"); expect(r.flow?.flowId).toBe("clparaffins");
  });
  it("Cl paraffins: 0.15% itself is NG, 0.1% is OK", () => {
    expect(run2({ errorType: "Prohibited substance", facts: row("85681-73-8", { "Substance Content(%) [col 31]": "0.15" }) }).recommendation.state).toBe("NG");
    expect(run2({ errorType: "Prohibited substance", facts: row("85681-73-8", { "Substance Content(%) [col 31]": "0.1" }) }).recommendation.state).toBe("OK");
  });
  it("paraffin oil 85422-92-0 asks the supplier", () => {
    const r = run2({ errorType: "Prohibited substance", facts: row("85422-92-0") });
    expect(r.flow?.next?.id).toBe("sccpOil");
    expect(run2({ errorType: "Prohibited substance", facts: row("85422-92-0"), answers: { sccpOil: "N" } }).recommendation.comment).toMatch(/Not containing/);
  });
  it("standard-chart flow (pitch): EU + supplier B holds, A gives NG, non-EU OK", () => {
    const f = row("65996-93-2");
    expect(run2({ errorType: "Prohibited substance", facts: f, destination: "KR" }).recommendation.state).toBe("OK");
    expect(run2({ errorType: "Prohibited substance", facts: f, destination: "EU", answers: { supplier: "A" } }).recommendation.state).toBe("NG");
    expect(run2({ errorType: "Prohibited substance", facts: f, destination: "EU", answers: { supplier: "B" } }).recommendation.state).toBe("HOLD");
  });
  const pb = (extra: Record<string, unknown> = {}) => facts2({ "CAS No. [col 29]": "7439-92-1", "Application ID [col 32]": "71", "Substance Content(%) [col 31]": "0.2", "IMDS Matl. Class. [col 27]": "2.1.1", ...extra });
  it("Application 71: aluminium, Pb 0.2%, supplier says machining → OK within exemption", () => {
    const r = run2({ errorType: "ELV (Pb)", facts: pb(), answers: { machining: "Y", __today: "2026-11-06" }, destination: "KR" });
    expect(r.recommendation.state).toBe("OK"); expect(r.recommendation.comment).toBe("The substance is within exemption.");
  });
  it("Application 71: asks the machining question first; non-aluminium → NG; Pb 0.5% → NG", () => {
    expect(run2({ errorType: "ELV (Pb)", facts: pb() }).flow?.next?.id).toBe("machining");
    expect(run2({ errorType: "ELV (Pb)", facts: pb({ "IMDS Matl. Class. [col 27]": "1.1" }) }).recommendation.state).toBe("NG");
    expect(run2({ errorType: "ELV (Pb)", facts: pb({ "Substance Content(%) [col 31]": "0.5" }) }).recommendation.state).toBe("NG");
  });
  it("Application 71 after the EU expiry date → HOLD, not OK", () => {
    const r = run2({ errorType: "ELV (Pb)", facts: pb(), answers: { machining: "Y", __today: "2028-02-01" }, destination: "EU" });
    expect(r.recommendation.state).toBe("HOLD");
  });
  it("Application44ERROR / No.24: supplier A → OK, B → NG; numeric 19 stays HOLD", () => {
    const f = row("");
    expect(run2({ errorType: "Application44ERROR", facts: f, supplierConfirmation: "SUPPLIER_CONFIRMED" }).recommendation.state).toBe("OK");
    expect(run2({ errorType: "24", facts: f, supplierConfirmation: "INPUT_MISTAKE" }).recommendation.state).toBe("NG");
    expect(run2({ errorType: "19", facts: f }).recommendation.state).toBe("HOLD");
  });
});


describe("substance error type routing", () => {
  it("connects numeric G-CATS substance codes 14–18 to the substance resolver", () => {
    for (const label of ["14", "No.14", "Error Type 15", "16. Prohibited substance", "17", "18.0"]) {
      expect(detectKind(label)).toBe("substance");
    }
    expect(detectKind("19")).toBe("manual");
  });
});
