import { describe, expect, it } from "vitest";
import { pileCounts, pileOf, type PileRow } from "@/lib/judgement/piles";

const row = (id: string, p: Partial<PileRow> = {}): PileRow => ({ id, source_status: "WORKING", judge: null, km_judge: null, error_type_label: "Mass tolerance range", ...p });

describe("workflow piles (To Judge / Judged / Waiting TMA)", () => {
  it("an unjudged WORKING case is To Judge", () => expect(pileOf(row("a"))).toBe("toJudge"));
  it("a saved judgement without KM is Waiting TMA — already judged, never To Judge", () => {
    expect(pileOf(row("a", { judge: "OK" }))).toBe("waitingTma");
    expect(pileOf(row("a", { judge: "NG", km_judge: "  " }))).toBe("waitingTma");
  });
  it("a saved judgement with the KM judge filled is Judged", () => expect(pileOf(row("a", { judge: "OK", km_judge: "OK" }))).toBe("judged"));
  it("reopening (judge cleared) returns a WORKING case to To Judge", () => expect(pileOf(row("a", { judge: "", km_judge: null }))).toBe("toJudge"));
  it("a failed save leaves the record unchanged in To Judge", () => {
    const before = row("a"); const afterFailedSave = { ...before };
    expect(pileOf(afterFailedSave)).toBe("toJudge");
  });
  it("missing or non-WORKING status without a judgement is Other, not work", () => {
    expect(pileOf(row("a", { source_status: null }))).toBe("other");
    expect(pileOf(row("a", { source_status: "ACCEPTED" }))).toBe("other");
    expect(pileOf(row("a", { source_status: "working " }))).toBe("toJudge");
  });
  it("a judged record keeps its pile whatever the source status says", () => expect(pileOf(row("a", { source_status: "ACCEPTED", judge: "OK" }))).toBe("waitingTma"));
  it("duplicate ids are counted once", () => {
    const c = pileCounts([row("a"), row("a"), row("b", { judge: "OK" })]);
    expect(c).toMatchObject({ toJudge: 1, waitingTma: 1, total: 2 });
  });
  it("a status change moves the record between piles", () => {
    const r = row("a");
    expect(pileCounts([r]).toJudge).toBe(1);
    expect(pileCounts([{ ...r, judge: "NG" }])).toMatchObject({ toJudge: 0, waitingTma: 1, judgedTotal: 1 });
    expect(pileCounts([{ ...r, judge: "NG", km_judge: "NG" }])).toMatchObject({ waitingTma: 0, judged: 1, judgedTotal: 1 });
  });
  it("category filter uses the same definitions", () => {
    const rows = [row("a"), row("b", { error_type_label: "WARP Part number" }), row("c", { judge: "OK", error_type_label: "WARP Part number" })];
    expect(pileCounts(rows, "WARP Part number")).toMatchObject({ toJudge: 1, waitingTma: 1, total: 2 });
  });
  it("totals reconcile: piles are mutually exclusive, Waiting TMA is part of Judged total, never of remaining", () => {
    const rows = [row("a"), row("b", { judge: "OK" }), row("c", { judge: "NG", km_judge: "NG" }), row("d", { source_status: "ACCEPTED" }), row("e", { judge: "OK" })];
    const c = pileCounts(rows);
    expect(c.toJudge + c.judged + c.waitingTma + c.other).toBe(c.total);
    expect(c.judgedTotal).toBe(c.judged + c.waitingTma);
    expect(c).toMatchObject({ toJudge: 1, waitingTma: 2, judged: 1, other: 1, total: 5, judgedTotal: 3 });
  });
});
