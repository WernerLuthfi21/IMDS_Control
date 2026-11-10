import { describe, expect, it } from "vitest";
import { groupBulkCandidates, prohibitedConnectionStatus, type BulkCandidate } from "@/lib/judgement/bulk";

function candidate(id: string, signature: string, eligible = true): BulkCandidate {
  return {
    id, sourceRecordKey: id, errorType: "Prohibited substance", partNo: "PART-01", supplierCode: "SUP-01",
    cas: "71-55-6", substanceName: "Test substance", kind: "substance",
    recommendation: { state: "NG", comment: "Input mistake", reason: "Exact source rule" },
    procedureText: "GADSL + TSZ trace", signature, eligible, inPendingQueue: true,
    prohibited: true, prohibitedStatus: "CONNECTED", reviewReason: "Exact source rule"
  };
}
describe("strict bulk judgement grouping", () => {
  it("groups only eligible records with the same complete signature", () => {
    const groups = groupBulkCandidates([candidate("a", "same"), candidate("b", "same"), candidate("c", "different")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(2);
    expect(groups[0].items.map((item) => item.id)).toEqual(["a", "b"]);
  });
  it("never groups HOLD, reviewed, or individually different cases", () => {
    const groups = groupBulkCandidates([
      candidate("a", "same", false), candidate("b", "same", true),
      { ...candidate("c", "same"), inPendingQueue: false }, candidate("d", "different", true)
    ]);
    expect(groups).toHaveLength(0);
  });
});


describe("prohibited-substance route connectivity", () => {
  it("requires both a verified reference match and an implemented flow", () => {
    expect(prohibitedConnectionStatus({ prohibited: true, gadslStatus: "DONE", tszStatus: "INFO", flowImplemented: true })).toBe("CONNECTED");
    expect(prohibitedConnectionStatus({ prohibited: true, gadslStatus: "INFO", tszStatus: "DONE", flowImplemented: true })).toBe("CONNECTED");
    expect(prohibitedConnectionStatus({ prohibited: true, gadslStatus: "DONE", tszStatus: "INFO", flowImplemented: false })).toBe("NEEDS_REVIEW");
    expect(prohibitedConnectionStatus({ prohibited: true, gadslStatus: "INFO", tszStatus: "INFO", flowImplemented: true })).toBe("NEEDS_REVIEW");
  });

  it("does not classify non-prohibited records as substance-routing cases", () => {
    expect(prohibitedConnectionStatus({ prohibited: false, flowImplemented: false })).toBe("NOT_PROHIBITED");
  });
});
