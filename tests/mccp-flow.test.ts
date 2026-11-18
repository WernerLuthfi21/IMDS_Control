import { describe, expect, it } from "vitest";
import { runAutoWorkflow, detectKind } from "@/lib/judgement/auto";
import { extractRowFacts } from "@/lib/judgement/row-facts";
import { decideAuto, DEFAULT_AUTOJUDGE, RULESET } from "@/lib/judgement/autojudge";
import { classifyCase } from "@/lib/judgement/review";
import { needsTmc } from "@/lib/judgement/escalation";

// Source: G-CATS Manual Judgment Flow – MCCP (RI CM 2026-02), slide 8 "Reference: MCCP judge flow (draft)".
const row = (cas = "85535-85-9") => extractRowFacts({ "CAS No. [col 29]": cas, "Substance Content(%) [col 31]": "3" });
const ET = "Prohibited(MCCP)";

describe("MCCP judge flow (draft, No.14)", () => {
  it("is a substance case routed to the MCCP flow by the G-CATS error type", () => {
    expect(detectKind(ET)).toBe("substance");
    const r = runAutoWorkflow({ errorType: ET, facts: row() });
    expect(r.flow?.flowId).toBe("mccp");
    expect(r.flow?.draft).toBe(true);
    expect(r.flow?.source).toMatch(/MCCP/);
  });
  it("asks the destination first", () => {
    const r = runAutoWorkflow({ errorType: ET, facts: row() });
    expect(r.flow?.next?.id).toBe("destination");
    expect(r.recommendation.state).toBe("HOLD");
    expect(r.needs.destination).toBe(true);
  });
  it("B · non-regulated destination → OK 'Only non-Regulated destination.'", () => {
    for (const d of ["KR", "CN", "TW", "IN", "OTH"]) {
      const r = runAutoWorkflow({ errorType: ET, facts: row(), destination: d });
      expect(r.recommendation.state).toBe("OK");
      expect(r.recommendation.comment).toBe("Only non-Regulated destination.");
    }
  });
  it("A · EU / JP → asks the supplier", () => {
    for (const d of ["EU", "JP"]) {
      const r = runAutoWorkflow({ errorType: ET, facts: row(), destination: d });
      expect(r.flow?.next?.id).toBe("supplier");
      expect(r.recommendation.state).toBe("HOLD");
    }
  });
  it("supplier A · input mistake → NG", () => {
    const r = runAutoWorkflow({ errorType: ET, facts: row(), destination: "EU", answers: { supplier: "A" } });
    expect(r.recommendation.state).toBe("NG");
    expect(r.recommendation.comment).toBe("Supplier input mistake.");
  });
  it("supplier B · contains (≥45% chlorination) → HOLD and report to TMC", () => {
    const r = runAutoWorkflow({ errorType: ET, facts: row(), destination: "JP", answers: { supplier: "B" } });
    expect(r.recommendation.state).toBe("HOLD");
    expect(r.recommendation.reason).toMatch(/TME\/TMNA\/TMA and TMC/);
    expect(needsTmc(r.recommendation.reason)).toBe(true);
  });
  it("wins over the SCCP flow even when the CAS is a generic chlorinated paraffin", () => {
    const r = runAutoWorkflow({ errorType: "14 Prohibited(MCCP)", facts: row("61788-76-9"), destination: "KR" });
    expect(r.flow?.flowId).toBe("mccp");
    expect(runAutoWorkflow({ errorType: "Prohibited substance(SCCP)", facts: row("61788-76-9") }).flow?.flowId).toBe("sccp");
  });
  it("Error Type 19 still wins (always HOLD)", () => {
    expect(runAutoWorkflow({ errorType: "19 Prohibited(MCCP)", facts: row(), destination: "KR" }).recommendation.state).toBe("HOLD");
  });
  it("is never finalised by the system, even with every family switched on", () => {
    const cfg = { ...DEFAULT_AUTOJUDGE, enabled: true, shadow: false, kinds: { mass: true, sms: true, app44: true, pb: true, elv: true, substance: true, warp: true }, ruleSet: RULESET };
    const d = decideAuto({ kind: "substance", eligible: true, inPendingQueue: true, errorType: ET, reviewReason: "",
      recommendation: { state: "OK", comment: "Only non-Regulated destination.", reason: "Flow result" }, draftFlow: true }, cfg);
    expect(d.action).toBe("SKIP");
  });
  it("review card: the destination pile first, then the supplier pile", () => {
    const a = runAutoWorkflow({ errorType: ET, facts: row() });
    expect(classifyCase(a, { eligible: false, tmcOpen: false, facts: {} }).need).toBe("destination");
    const b = runAutoWorkflow({ errorType: ET, facts: row(), destination: "EU" });
    const card = classifyCase(b, { eligible: false, tmcOpen: false, facts: {} });
    expect(card.need).toBe("supplier");
    expect(card.question?.options.map((o) => o[0])).toEqual(["A", "B"]);
  });
});
