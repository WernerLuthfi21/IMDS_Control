import { describe, expect, it } from "vitest";
import { runAutoWorkflow } from "@/lib/judgement/auto";
import { classifyCase } from "@/lib/judgement/review";

const facts = { cas: "", substanceName: "", substanceContentPct: "", applicationId: "", materialName: "", matlClass: "", componentPartName: "", deliveryPartName: "", imdsMass: "", drawingMass: "", toleranceClass: "", drawingRefs: [], drawingStatus: "", companyName: "" };
const cls = (a: ReturnType<typeof runAutoWorkflow>, eligible = false) => classifyCase(a, { eligible, tmcOpen: false, facts: {} });

describe("review piles", () => {
  it("mass case without a class goes to the drawing pile with MA–MF buttons", () => {
    const c = cls(runAutoWorkflow({ errorType: "Mass tolerance range", facts: { ...facts, imdsMass: "12.4", drawingMass: "12" } }));
    expect(c.need).toBe("drawing");
    expect(c.question?.options.map((o) => o[0])).toEqual(["MA", "MB", "MC", "MD", "ME", "MF"]);
  });
  it("PCB asks the supplier about intentional use (supplier pile)", () => {
    const c = cls(runAutoWorkflow({ errorType: "Prohibited substance", facts: { ...facts, cas: "1336-36-3", substanceContentPct: "0.000003" } }));
    expect(c.need).toBe("supplier");
    expect(c.question?.id).toBe("intent");
  });
  it("a decided, eligible case is ready to confirm", () => {
    const a = runAutoWorkflow({ errorType: "SMS Mass", facts, supplierConfirmation: "INPUT_MISTAKE" });
    expect(cls(a, true).need).toBe("ready");
  });
  it("unknown error types go to manual, missing CAS to missing data", () => {
    expect(cls(runAutoWorkflow({ errorType: "Something new", facts })).need).toBe("manual");
    expect(cls(runAutoWorkflow({ errorType: "Prohibited substance", facts })).need).toBe("missing");
  });
  it("WARP without a registered code goes to the Purchasing pile", () => {
    expect(cls(runAutoWorkflow({ errorType: "WARP Part number", facts, supplierCode: "ZZ999" })).need).toBe("purchasing");
  });
  it("an open TMC escalation goes to the TMC pile", () => {
    const a = runAutoWorkflow({ errorType: "SMS Mass", facts });
    expect(classifyCase(a, { eligible: false, tmcOpen: true, facts: {} }).need).toBe("tmc");
  });
});
