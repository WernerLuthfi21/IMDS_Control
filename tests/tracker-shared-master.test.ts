import { describe, expect, it } from "vitest";
import { trackerFixture } from "@/components/tracker/fixture-data";
import {
  buildModelRegistry, buildTrackerDataset, classifyTrackerStatus, countParts, emptyScope, nextModelDeadline, scopeParts
} from "@/lib/tracker/shared-master";

const sampleDate = new Date(2026, 10, 26, 13);
const emptyDueDates = { version: 0, models: {}, suppliers: {} };

describe("Tracker shared master presentation parity", () => {
  it("consolidates duplicates before moving Check and Stop run outside the general metrics", () => {
    const data = buildTrackerDataset(trackerFixture.snapshot.rows, sampleDate);
    expect(data.rawCount).toBe(10);
    expect(countParts(data.active)).toEqual({ total: 7, complete: 4, process: 1, missing: 1, rejected: 1, review: 0, stop: 0, pastDue: 2 });
    expect(data.checks.map(part => part.partNo)).toEqual(["FIX-203"]);
    expect(data.stopped.map(part => part.partNo)).toEqual(["FIX-303"]);
    expect(data.duplicates).toMatchObject([{ partNo: "FIX-201", partName: "Seal cover", sourceCount: 2, status: "rejected", targetDate: new Date(2024, 0, 15) }]);
  });

  it("keeps blank part numbers distinct and normalizes model and part number aliases for deduplication", () => {
    const data = buildTrackerDataset([
      { company_name: "Fixture", project: "X — 1", part_no: "PN1", imds_status: "missIng" },
      { company_name: "Fixture", project: "X-1", part_no: "pn1", imds_status: "Accepted" },
      { company_name: "Fixture", project: "X-1", part_no: "" },
      { company_name: "Fixture", project: "X-1", part_no: "" }
    ], sampleDate);
    expect(data.active.map(part => [part.model, part.partNo, part.status])).toEqual([
      ["X-1", "PN1", "complete"], ["X-1", "", "missing"], ["X-1", "", "missing"]
    ]);
  });

  it("retains the original distinction between unknown, rejected, and missing states", () => {
    expect(["not accepted", "unknown", "reject", "#N/A", "", "working", "STOP-RUN"].map(classifyTrackerStatus))
      .toEqual(["review", "review", "rejected", "missing", "missing", "process", "stop"]);
  });

  it("uses team deadlines, hidden models, and dash-insensitive part search", () => {
    const data = buildTrackerDataset(trackerFixture.snapshot.rows, sampleDate);
    const models = buildModelRegistry(data.active, { "SYNTH-01": { deadline: "2025-01-01" }, "SYNTH-03": { dash: false } }, trackerFixture.dueDates, sampleDate);
    expect(models[0].deadline).toEqual(new Date(2024, 1, 1));
    expect(nextModelDeadline(models)?.key).toBe("SYNTH-02");
    expect(scopeParts(data.active, models, { ...emptyScope, query: "fix201" }).map(part => part.partNo)).toEqual(["FIX-201"]);
    expect(scopeParts(data.active, models, { ...emptyScope, query: "fix305" })).toEqual([]);
  });

  it("preserves the legacy default and cleared browser deadlines", () => {
    const data = buildTrackerDataset([{ project: "688D" }], sampleDate);
    expect(buildModelRegistry(data.active, {}, emptyDueDates, sampleDate)[0].deadline).toEqual(new Date(2026, 8, 25));
    expect(buildModelRegistry(data.active, { "688D": { deadline: "" } }, emptyDueDates, sampleDate)[0].deadline).toBeNull();
    expect(buildModelRegistry(data.active, { "688D": { deadline: "2025-02-01" } }, { ...emptyDueDates, version: 1 }, sampleDate)[0].deadline).toBeNull();
  });
});
