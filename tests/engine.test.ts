import { describe, expect, it } from "vitest";
import { evaluateJudgement, findMassTolerance } from "../lib/judgement/engine";

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
  it("does not find a mass range for non-numeric input", () => {
    expect(() => findMassTolerance("not-a-mass", "MA")).toThrow();
  });
});
