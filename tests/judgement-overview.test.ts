import { describe, expect, it } from "vitest";
import { attentionItems, bottlenecks, summarizeRegister, type OverviewRow } from "@/lib/judgement/overview";

const row = (o: Partial<OverviewRow>): OverviewRow => ({
  error_type_label: "Type A", supplier_code: "S1", delivery_part_no: "P1", source_status: "WORKING", judge: null, km_judge: null, ...o
});

describe("summarizeRegister", () => {
  const rows = [
    row({ judge: "OK", km_judge: "OK" }),
    row({ judge: "NG", supplier_code: "S2", delivery_part_no: "P2" }),
    row({}),
    row({ supplier_code: "S2", error_type_label: "Type B", delivery_part_no: "p2" }),
    row({ source_status: "CLOSED" })
  ];
  const s = summarizeRegister(rows);

  it("counts totals, pending, KM backlog and percent judged", () => {
    expect(s.total).toBe(5);
    expect(s.judged).toBe(2);
    expect(s.pending).toBe(2);
    expect(s.km).toBe(1);
    expect(s.pct).toBe(40);
    expect(s.parts).toBe(2);
  });
  it("puts every row in exactly one band", () => {
    expect(s.band.map((b) => [b.key, b.n])).toEqual([["ok", 1], ["ng", 1], ["pending", 2], ["other", 1]]);
    expect(s.band.reduce((a, b) => a + b.n, 0)).toBe(s.total);
  });
  it("lists only suppliers with open work, most pending first", () => {
    expect(s.suppliers.map((x) => x.code)).toEqual(["S1", "S2"]);
    expect(s.suppliers.find((x) => x.code === "S2")).toEqual({ code: "S2", ok: 0, ng: 1, pending: 1, all: 2 });
  });
  it("splits error types into open and judged", () => {
    expect(s.types[0]).toEqual({ label: "Type A", open: 1, judged: 2, all: 4 });
  });
  it("handles an empty register", () => {
    expect(summarizeRegister([]).pct).toBe(0);
  });
});

describe("attentionItems", () => {
  it("puts outside blockers before internal work and biggest first", () => {
    const items = attentionItems({ ready: 9, destination: 40, supplier: 3, tmc: 5 }, 2);
    expect(items.map((x) => x.key)).toEqual(["tmc", "supplier", "answer", "ready", "km"]);
    expect(items[0].headline).toBe("5 cases on hold for TMC / TMNA confirmation");
  });
  it("sends 'waiting for your answer' to the biggest question pile", () => {
    expect(attentionItems({ check: 4, drawing: 1, destination: 2 }, 0)[0]).toMatchObject({ key: "answer", n: 7, need: "check" });
  });
  it("is empty when nothing is open", () => {
    expect(attentionItems(null, 0)).toEqual([]);
  });
});

describe("bottlenecks", () => {
  it("lists non-empty piles, biggest first", () => {
    expect(bottlenecks({ ready: 1, supplier: 220, manual: 19 }).map((x) => x.need)).toEqual(["supplier", "manual", "ready"]);
  });
});
