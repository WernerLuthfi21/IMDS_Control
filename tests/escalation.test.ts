import { describe, expect, it } from "vitest";
import { escalationKey, needsTmc, tmcRecommendation } from "@/lib/judgement/escalation";

describe("TMC escalation", () => {
  it("recognises flow results that send the case to TMC", () => {
    expect(needsTmc("Supplier confirms the phthalate is contained at or above 0.1wt%. Contact TMC/TMNA/TME/TDEM; do not judge yet.")).toBe(true);
    expect(needsTmc('Flow result: Judge OK — "Use is not prohibit." Report the P/N and supplier information to TMC first.')).toBe(true);
    expect(needsTmc("Inside TSZ2900G band.")).toBe(false);
  });
  it("builds a stable key per part, error type, CAS and flow", () => {
    const a = escalationKey({ partNo: " 90119-a1 ", errorType: "Prohibited  substance", cas: "117-81-7", flowId: "phthalate" });
    const b = escalationKey({ partNo: "90119-A1", errorType: "prohibited substance", cas: "117-81-7", flowId: "phthalate" });
    expect(a).toBe(b);
    expect(a.split("|")).toHaveLength(4);
    expect(escalationKey({ partNo: null, errorType: "X" })).toBe("-|x|-|-");
  });
  it("turns a confirmed answer into the recommendation, never before", () => {
    const base = { caseKey: "k", note: "Allowed for this destination", sentAt: "2026-11-10T00:00:00Z", answeredAt: "2026-11-12T03:00:00Z", updatedByName: "Ayu" };
    expect(tmcRecommendation({ ...base, status: "SENT", answer: null })).toBeNull();
    expect(tmcRecommendation({ ...base, status: "CONFIRMED", answer: "OK" })).toEqual({ state: "OK", comment: "Confirmed by TMC on 2026-11-12: Allowed for this destination", reason: "TMC answered OK on 2026-11-12 (recorded by Ayu)." });
  });
});
