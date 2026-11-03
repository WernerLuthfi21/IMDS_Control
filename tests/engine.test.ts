import { describe, expect, it } from "vitest";
import { calculateMassToleranceBands, evaluateJudgement, findMassTolerance } from "../lib/judgement/engine";

describe("G-CATS judgement guardrails", () => {
  it("holds numeric Error Type 19 irrespective of catalogue selection", () => {
    const a = evaluateJudgement({ errorType: 19, sourceCatalog: "appendix_judgement_criteria" });
    const b = evaluateJudgement({ errorType: 19, sourceCatalog: "system_error_check" });
    expect(a.recommendation).toBe("HOLD");
    expect(b.recommendation).toBe("HOLD");
    expect(a.ruleId).toBe("RULE-19-CONFLICT");
  });
  it("never turns supplier-missing SMS mass into an automatic result", () => {
    expect(evaluateJudgement({ errorType: 6 }).recommendation).toBe("MANUAL_REVIEW");
  });
  it("uses exact supplier flow comments for Error Type 6", () => {
    const ok = evaluateJudgement({ errorType: 6, supplierConfirmation: "ACTUAL_OR_CALCULATED_MASS" });
    const ng = evaluateJudgement({ errorType: 6, supplierConfirmation: "INPUT_MISTAKE" });
    expect(ok.comment).toBe("Confirmed by Supplier.");
    expect(ng.comment).toBe("Mass is incorrect.");
    expect(ok.finalDecision).toBe("PENDING");
  });
  it("does not invent the Error Type 8 denominator", () => {
    expect(evaluateJudgement({ errorType: 8, componentPartMass: 10, totalMaterialMass: 9.8 }).recommendation).toBe("MANUAL_REVIEW");
  });
  it("returns manual review for prohibited substance families until the flow is verified", () => {
    expect(evaluateJudgement({ errorType: 16 }).recommendation).toBe("HOLD");
  });
  it("uses the workbook TSZ2900 tolerance class and the additional 10% buffer", () => {
    const core = calculateMassToleranceBands(1400, 1430, "MB");
    expect(core.found).toBe(true);
    if (!core.found) return;
    expect(core.tolerance.toString()).toBe("70");
    expect(core.min.toString()).toBe("1360");
    expect(core.max.toString()).toBe("1500");
    expect(core.bufferMin.toString()).toBe("1224");
    expect(core.bufferMax.toString()).toBe("1650");
    expect(core.band).toBe("WITHIN_TSZ_RANGE");

    const buffer = evaluateJudgement({ errorType: 7, imdsMass: 1300, drawingMass: 1430, toleranceClass: "MB" });
    expect(buffer.recommendation).toBe("RECOMMEND_OK");
    expect(buffer.comment).toBe("Confirmed with Drawing.");

    const outside = evaluateJudgement({ errorType: 7, imdsMass: 1100, drawingMass: 1430, toleranceClass: "MB" });
    expect(outside.recommendation).toBe("MANUAL_REVIEW");
    expect(outside.manualTasks.join(" ")).toContain("supplier confirmation");
    const supplierA = evaluateJudgement({ errorType: 7, imdsMass: 1100, drawingMass: 1430, toleranceClass: "MB", supplierConfirmation: "ACTUAL_OR_CALCULATED_MASS" });
    const supplierB = evaluateJudgement({ errorType: 7, imdsMass: 1100, drawingMass: 1430, toleranceClass: "MB", supplierConfirmation: "INPUT_MISTAKE" });
    expect(supplierA.comment).toBe("Confirmed by Supplier.");
    expect(supplierB.comment).toBe("Mass is incorrect.");
  });

  it("routes invalid or missing TSZ2900 classes to HOLD instead of guessing", () => {
    const missing = findMassTolerance(1430, "?");
    expect(missing.found).toBe(false);
    expect(evaluateJudgement({ errorType: 7, imdsMass: 1325, drawingMass: 1430, toleranceClass: "?" }).recommendation).toBe("HOLD");
  });

  it("does not find a mass range for non-numeric input", () => {
    expect(findMassTolerance("not-a-mass", "MA").found).toBe(false);
  });
});
