import { describe, expect, it } from "vitest";
import { DEFAULT_AUTOJUDGE, RULESET, decideAuto, sanitizeAutoJudge, type AutoJudgeConfig } from "@/lib/judgement/autojudge";
import { isMemoryField, partKey, validMemoryValue, describeMemory } from "@/lib/judgement/memory";

const live: AutoJudgeConfig = { ...DEFAULT_AUTOJUDGE, enabled: true, shadow: false, kinds: { mass: true, sms: true, app44: true, pb: true, elv: true, substance: true, warp: true }, ruleSet: RULESET };
const base = {
  kind: "mass" as const, eligible: true, inPendingQueue: true, errorType: "Mass tolerance error", reviewReason: "",
  recommendation: { state: "OK" as const, comment: "Within tolerance.", reason: "Inside TSZ2900G band." }
};

describe("auto-judgement decision", () => {
  it("an approval given for an older rule set does not finalise anything", () => {
    const d = decideAuto(base, { ...live, ruleSet: "gcats-v5110" });
    expect(d.action).toBe("WOULD_FINAL");
    expect(d.reason).toMatch(/Manual Flow Ver\.7/);
    expect(decideAuto(base, { ...live, ruleSet: null }).action).toBe("WOULD_FINAL");
  });
  it("is off by default: nothing is written, the decision is only previewed", () => {
    expect(DEFAULT_AUTOJUDGE.enabled).toBe(false);
    expect(decideAuto(base, DEFAULT_AUTOJUDGE)).toMatchObject({ action: "WOULD_FINAL", decision: "OK" });
  });
  it("finalises a complete case when the master switch and its family are on", () => {
    expect(decideAuto(base, live)).toMatchObject({ action: "FINAL", decision: "OK" });
    expect(decideAuto({ ...base, recommendation: { ...base.recommendation, state: "NG" } }, live)).toMatchObject({ action: "FINAL", decision: "NG" });
  });
  it("shadow mode decides but never writes", () => {
    expect(decideAuto(base, { ...live, shadow: true })).toMatchObject({ action: "WOULD_FINAL" });
  });
  it("respects per-family switches", () => {
    expect(decideAuto(base, { ...live, kinds: { ...live.kinds, mass: false } })).toMatchObject({ action: "WOULD_FINAL" });
  });
  it("never finalises Error Type 19, even when the engine is sure", () => {
    expect(decideAuto({ ...base, kind: "substance", errorType: "19" }, live).action).toBe("SKIP");
    expect(decideAuto({ ...base, kind: "substance", errorType: "Error Type 19.0" }, live).action).toBe("SKIP");
  });
  it("never finalises HOLD, incomplete or non-pending cases", () => {
    expect(decideAuto({ ...base, recommendation: { state: "HOLD" as never, comment: "", reason: "x" } }, live).action).toBe("SKIP");
    expect(decideAuto({ ...base, eligible: false, reviewReason: "Missing class" }, live)).toMatchObject({ action: "SKIP", reason: "Missing class" });
    expect(decideAuto({ ...base, inPendingQueue: false }, live).action).toBe("SKIP");
    expect(decideAuto({ ...base, kind: "manual" as never }, live).action).toBe("SKIP");
  });
  it("sanitises stored settings defensively", () => {
    const s = sanitizeAutoJudge({ enabled: "yes", shadow: false, kinds: { mass: true, bogus: true }, approvedBy: 5 });
    expect(s.enabled).toBe(false);
    expect(s.shadow).toBe(false);
    expect(s.kinds).toEqual({ mass: true, sms: false, app44: false, pb: false, elv: false, substance: false, warp: false });
    expect(s.ruleSet).toBeNull();
    expect(s.approvedBy).toBeNull();
    expect(sanitizeAutoJudge(null)).toEqual(DEFAULT_AUTOJUDGE);
  });
});

describe("judgement memory", () => {
  it("only remembers Toyota-owned answers with valid values", () => {
    expect(isMemoryField("destination")).toBe(true);
    expect(isMemoryField("supplierConfirmation")).toBe(false);
    expect(validMemoryValue("destination", "EU")).toBe(true);
    expect(validMemoryValue("destination", "MARS")).toBe(false);
    expect(validMemoryValue("toleranceClass", "MC")).toBe(true);
    expect(validMemoryValue("toleranceClass", "MZ")).toBe(false);
    expect(validMemoryValue("usCarpet", "Y")).toBe(true);
  });
  it("normalises the part key", () => {
    expect(partKey(" 12345-ab 678 ")).toBe("12345-AB678");
    expect(partKey(null)).toBe("");
  });
  it("explains where a remembered answer came from", () => {
    expect(describeMemory({ field: "destination", value: "EU", setByName: "Werner", source: "reviewer", updatedAt: "2026-11-18T01:00:00Z" })).toBe("Remembered from Werner on 2026-11-18");
  });
});
