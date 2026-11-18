import { describe, expect, it } from "vitest";
import { runAutoWorkflow, detectKind } from "@/lib/judgement/auto";
import { extractRowFacts } from "@/lib/judgement/row-facts";
import { lookupPbPolicy } from "@/lib/judgement/pb-policy";
import { classifyCase } from "@/lib/judgement/review";

// Source: G-CATS Manual Flow Ver.7 (PROTECTED, uploaded 2026-11-18). Page numbers are PDF pages.
const row = (cas: string, extra: Record<string, unknown> = {}) => extractRowFacts({ "CAS No. [col 29]": cas, "Substance Content(%) [col 31]": "1", ...extra });
const run = (errorType: string, facts: ReturnType<typeof row>, destination?: string, answers: Record<string, string> = {}) =>
  runAutoWorkflow({ errorType, facts, destination, answers });

describe("ELV Cd / Hg / Cr6+ (Ver.7 No.11–13, pp.19–21)", () => {
  const elv = (app: string, pct: string) => extractRowFacts({ "Application ID [col 32]": app, "Substance Content(%) [col 31]": pct, "Material Name [col 26]": "Steel" });
  it("is its own kind (was manual before)", () => {
    expect(detectKind("ELV (Cd)")).toBe("elv");
    expect(detectKind("ELV (Hg)")).toBe("elv");
    expect(detectKind("ELV (Cr6+)")).toBe("elv");
    expect(detectKind("ELV (Pb)")).toBe("pb");
  });
  it("Cd: below 0.01wt% → OK; Application ID 20 → supplier; contains → TMC", () => {
    const facts = elv("44", "0.005");
    const r = runAutoWorkflow({ errorType: "ELV (Cd)", facts });
    expect(r.recommendation).toMatchObject({ state: "OK", comment: "The substance is below threshold." });
    expect(r.flow?.source).toMatch(/Ver\.7/);
    const s = runAutoWorkflow({ errorType: "ELV (Cd)", facts: elv("20", "0.005") });
    expect(s.flow?.next?.id).toBe("supplier");
    expect(runAutoWorkflow({ errorType: "ELV (Cd)", facts: elv("20", "0.005"), answers: { supplier: "A" } }).recommendation.state).toBe("NG");
    expect(runAutoWorkflow({ errorType: "ELV (Cd)", facts: elv("44", "0.02"), answers: { supplier: "B" } }).recommendation.reason).toMatch(/Contact TMC/);
  });
  it("Cr6+: 0.1wt% is OK", () => {
    expect(runAutoWorkflow({ errorType: "ELV (Cr6+)", facts: elv("44", "0.1") }).recommendation.state).toBe("OK");
  });
  it("Hg: ≤0.1 non-JP/NA → OK; JP with App 46 → OK unintentional; JP other App → NG + TMC; OTH asks North America", () => {
    expect(runAutoWorkflow({ errorType: "ELV (Hg)", facts: elv("44", "0.05"), destination: "EU" }).recommendation.comment).toBe("The substance is below threshold.");
    expect(runAutoWorkflow({ errorType: "ELV (Hg)", facts: elv("46", "0.05"), destination: "JP" }).recommendation.comment).toBe("The substance is unintentional use.");
    const ng = runAutoWorkflow({ errorType: "ELV (Hg)", facts: elv("44", "0.05"), destination: "JP" });
    expect(ng.recommendation.state).toBe("NG"); expect(ng.recommendation.reason).toMatch(/TMC/);
    expect(runAutoWorkflow({ errorType: "ELV (Hg)", facts: elv("44", "0.05"), destination: "OTH" }).flow?.next?.id).toBe("naDest");
  });
});

describe("No.14 substance flows (Ver.7)", () => {
  it("HCB (p.26): non-intentional + non-Japan supplier → OK non-regulated, no EU threshold branch", () => {
    const r = run("Prohibited substance", row("118-74-1"), "EU", { intent: "A", supplierJp: "N" });
    expect(r.flow?.flowId).toBe("hcb");
    expect(r.recommendation).toMatchObject({ state: "OK", comment: "Only non-Regulated destination." });
    expect(run("Prohibited substance", row("118-74-1"), "EU", { intent: "B" }).recommendation.state).toBe("NG");
  });
  it("PCB (p.30) unchanged: EU + below 2ppm → OK", () => {
    const r = run("Prohibited substance", row("1336-36-3", { "Substance Content(%) [col 31]": "0.0001" }), "EU", { intent: "A" });
    expect(r.recommendation).toMatchObject({ state: "OK", comment: "Below 0.0002wt%." });
  });
  it("PFOA (p.28): EU + content ≥25ppb → NG; non-EU non-Japan + non-intentional → OK; JP → TMC", () => {
    expect(run("Prohibited substance", row("335-67-1"), "EU", { supplier: "B" }).recommendation.state).toBe("NG");
    expect(run("Prohibited substance", row("335-67-1"), "EU", { supplier: "A" }).recommendation.comment).toBe("Supplier input mistake.");
    expect(run("Prohibited substance", row("335-67-1"), "KR", { supplier: "B", supplierJp: "N", intent: "A" }).recommendation.comment).toBe("Use is not prohibit.");
    expect(run("Prohibited substance", row("335-67-1"), "JP", { supplier: "B" }).recommendation.reason).toMatch(/Contact TMC/);
  });
  it("HFC (p.27): refrigerant of an air conditioner → OK from the part names, otherwise supplier", () => {
    const ac = row("811-97-2", { "Delivery Part Name [col 18]": "AIR CONDITIONER ASSY", "Component Part Name [col 22]": "REFRIGERANT HFC-134A" });
    expect(run("Prohibited substance", ac).recommendation).toMatchObject({ state: "OK", comment: "Use is not prohibit." });
    expect(run("Prohibited substance", row("811-97-2", { "Delivery Part Name [col 18]": "SEAT" })).flow?.next?.id).toBe("airCon");
  });
  it("Perchlorate (p.31): non-NA → OK; NA + airbag initiator → OK; NA + PVC asks new use", () => {
    expect(run("Prohibited substance", row("7790-98-9"), "EU").recommendation.comment).toBe("Only non-Regulated destination.");
    expect(run("Prohibited substance", row("7790-98-9", { "Component Part Name [col 22]": "AIRBAG INITIATOR", "Material Name [col 26]": "Zirconium potassium perchlorate" }), "OTH", { naDest: "Y" }).recommendation.comment).toBe("Use is not prohibit.");
    expect(run("Prohibited substance", row("7790-98-9", { "Material Name [col 26]": "PVC compound" }), "OTH", { naDest: "Y" }).flow?.next?.id).toBe("newUse");
  });
  it("Benzidine (p.25): benzidine group → supplier; contains → TMC", () => {
    const r = run("Prohibited substance", row("92-87-5"));
    expect(r.flow?.flowId).toBe("benzidineAzo");
    expect(r.flow?.next?.id).toBe("supplier");
  });
  it("POPs generic (p.22): destination, then the Appendix 4 check with the country cell shown", () => {
    const a = run("Prohibited substance", row("58-89-9"));
    expect(a.flow?.flowId).toBe("pops");
    const b = run("Prohibited substance", row("58-89-9"), "EU");
    expect(b.flow?.next?.id).toBe("appendixLegal");
    expect(b.flow?.next?.text).toMatch(/Appendix 4/);
    expect(run("Prohibited substance", row("58-89-9"), "EU", { appendixLegal: "A" }).recommendation.comment).toBe("The substance is below threshold.");
    expect(run("Prohibited substance", row("58-89-9"), "EU", { appendixLegal: "C" }).recommendation.state).toBe("HOLD");
    expect(run("Prohibited substance", row("58-89-9"), "EU", { appendixLegal: "B", supplier: "A" }).recommendation.state).toBe("NG");
  });
  it("Annex XVII (p.23): non-EU without a listed requirement → OK; EU → Appendix 5 check", () => {
    const r = run("Prohibited substance", row("624-49-7"), "KR");
    expect(r.flow?.flowId).toBe("annex17");
    expect(["OK", "HOLD"]).toContain(r.recommendation.state);
    expect(run("Prohibited substance", row("624-49-7"), "EU").flow?.next?.id).toBe("appendixLegal");
  });
  it("Annex XIV (p.24): before sunset → OK; else threshold, supplier location, destination, supplier", () => {
    const f = row("90640-80-5");
    expect(run("Prohibited substance", f).flow?.flowId).toBe("annex14");
    expect(run("Prohibited substance", f, undefined, { sunset3m: "Y" }).recommendation.comment).toBe("Before expiry date.");
    expect(run("Prohibited substance", f, "KR", { sunset3m: "N", supplierEu: "N" }).recommendation.comment).toBe("Only non-Regulated destination.");
    const co = run("Prohibited substance", f, "EU", { sunset3m: "N", supplierEu: "N", supplier: "B" });
    expect(co.recommendation).toMatchObject({ state: "OK", comment: "Change over will be confirmed." });
    expect(co.recommendation.reason).toMatch(/TMC/);
  });
  it("Reviewer checks go to their own pile", () => {
    const b = run("Prohibited substance", row("58-89-9"), "EU");
    expect(classifyCase(b, { eligible: false, tmcOpen: false, facts: {} }).need).toBe("check");
  });
});

describe("Pb TOYOTA Policy Table (Ver.7 pp.10–17)", () => {
  it("ID 76 is OK everywhere, ID 75 NG only for EU/TW, ID 62 follows the standard pattern", () => {
    expect(lookupPbPolicy("76", "EU")).toMatchObject({ found: true, outcome: "OK" });
    expect(lookupPbPolicy("75", "EU")).toMatchObject({ outcome: "NG" });
    expect(lookupPbPolicy("75", "KR")).toMatchObject({ outcome: "OK" });
    expect(lookupPbPolicy("75", "TW")).toMatchObject({ outcome: "NG" });
    expect(lookupPbPolicy("62", "CN")).toMatchObject({ outcome: "OK" });
    expect(lookupPbPolicy("62", "KR")).toMatchObject({ outcome: "NG" });
  });
  it("entries with a bare '2026~' qualifier stay HOLD", () => {
    for (const id of ["68", "79", "86"]) expect(lookupPbPolicy(id, "EU")).toMatchObject({ outcome: "HOLD" });
  });
});

describe("Mass tolerance raw material branch (Ver.7 No.7, p.3)", () => {
  const mass = (imds: string, part: string) => extractRowFacts({ "IMDS mass (g) [col 51]": imds, "Drawing Mass (g) [col 54]": "100", "Delivery Part Name [col 18]": part });
  it("raw material heavier than the drawing → OK 'Confirmed with Drawing.'; lighter → NG", () => {
    const heavy = runAutoWorkflow({ errorType: "Mass tolerance range", facts: mass("150", "RAW MATERIAL, KNUCKLE"), toleranceClass: "MC" });
    const light = runAutoWorkflow({ errorType: "Mass tolerance range", facts: mass("50", "RAW MATERIAL, KNUCKLE"), toleranceClass: "MC" });
    const normal = runAutoWorkflow({ errorType: "Mass tolerance range", facts: mass("150", "KNUCKLE"), toleranceClass: "MC" });
    expect(heavy.recommendation).toMatchObject({ state: "OK", comment: "Confirmed with Drawing." });
    expect(heavy.steps.find((x) => x.id === "raw")?.detail).toMatch(/heavier/);
    expect(heavy.procedureText).toMatch(/Raw Material/);
    expect(light.recommendation.state).toBe("NG");
    expect(normal.recommendation.state).toBe("HOLD");
  });
});
