import { describe, expect, it } from "vitest";
import { checkWarp, isWarpError } from "@/lib/judgement/warp";
import { runAutoWorkflow, detectKind } from "@/lib/judgement/auto";
import { regionOfCode } from "@/lib/judgement/destinations";
import master from "@/data/reference/purchasing-supplier-code-master.json";

const first = (master as { entries: Array<{ code: string; name: string }> }).entries[0];
const facts = { cas: "", substanceName: "", substanceContentPct: "", applicationId: "", materialName: "", matlClass: "", componentPartName: "", deliveryPartName: "", imdsMass: "", drawingMass: "", toleranceClass: "", drawingRefs: [], drawingStatus: "", companyName: "" };

describe("WARP part number (Appendix I No.21)", () => {
  it("recognises the error type", () => {
    expect(isWarpError("WARP Part number")).toBe(true);
    expect(detectKind("WARP Part number")).toBe("warp");
    expect(isWarpError("Mass tolerance range")).toBe(false);
  });
  it("confirms a registered code with a matching name", () => {
    const c = checkWarp(first.code, "PT. " + first.name + " Tbk");
    expect(c.found).toBe(true);
    const r = runAutoWorkflow({ errorType: "WARP Part number", facts: { ...facts, companyName: first.name }, supplierCode: first.code });
    expect(r.recommendation).toMatchObject({ state: "OK", comment: "Confirmed by Purchasing Div." });
    expect(r.steps.every((s) => s.status === "DONE")).toBe(true);
  });
  it("asks Purchasing when the code is unknown or the name differs, then follows the answer", () => {
    const unknown = runAutoWorkflow({ errorType: "WARP Part number", facts, supplierCode: "ZZ999" });
    expect(unknown.recommendation.state).toBe("HOLD");
    expect(unknown.flow?.next?.id).toBe("purchasingWarp");
    const differs = runAutoWorkflow({ errorType: "WARP Part number", facts: { ...facts, companyName: "Completely Different Name" }, supplierCode: first.code });
    expect(differs.recommendation.state).toBe("HOLD");
    expect(runAutoWorkflow({ errorType: "WARP Part number", facts, supplierCode: "ZZ999", answers: { purchasingWarp: "N" } }).recommendation).toMatchObject({ state: "NG", comment: "Supplier code is incorrect." });
    expect(runAutoWorkflow({ errorType: "WARP Part number", facts, supplierCode: "ZZ999", answers: { purchasingWarp: "Y" } }).recommendation.state).toBe("OK");
  });
  it("maps TMMIN destination codes to rule regions", () => {
    expect(regionOfCode("W")).toBe("EU");
    expect(regionOfCode("V_IL")).toBe("EU");
    expect(regionOfCode("X_IN")).toBe("IN");
    expect(regionOfCode("A")).toBe("OTH");
    expect(regionOfCode("??")).toBeUndefined();
  });
});
