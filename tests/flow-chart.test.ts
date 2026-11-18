import { describe, expect, it } from "vitest";
import { flowChart, listFlows, type FlowChartNode } from "@/lib/judgement/flows";

function leaves(n: FlowChartNode): FlowChartNode[] {
  return n.branches.length ? n.branches.flatMap((b) => leaves(b.node)) : [n];
}

describe("flowChart", () => {
  const flows = listFlows();

  it("lists every implemented flow with a title and source", () => {
    expect(flows.length).toBeGreaterThan(10);
    for (const f of flows) { expect(f.title).toBeTruthy(); expect(f.source).toBeTruthy(); }
  });

  it("draws every flow down to an end result", () => {
    for (const f of flows) {
      const chart = flowChart(f.id, "2026-06-01");
      expect(chart, f.id).not.toBeNull();
      if (chart!.truncated) continue;
      for (const leaf of leaves(chart!.root)) expect(leaf.outcome, `${f.id}: open leaf`).not.toBeNull();
    }
  });

  it("merges destinations that lead to the same result (MCCP: only EU and JP are regulated)", () => {
    const chart = flowChart("mccp", "2026-06-01")!;
    expect(chart.draft).toBe(true);
    expect(chart.root.question?.id).toBe("destination");
    const ok = chart.root.branches.find((b) => b.node.outcome?.state === "OK");
    expect(ok?.labels).toEqual(["KR", "CN", "TW", "IN", "Other"]);
    const regulated = chart.root.branches.find((b) => b.labels.includes("EU"));
    expect(regulated?.labels).toEqual(["EU", "JP"]);
    expect(regulated?.node.question?.id).toBe("supplier");
  });

  it("follows the date: the EU Pb exemption is a TMC contact from 2028", () => {
    const before = JSON.stringify(flowChart("pb71", "2027-12-31"));
    const after = JSON.stringify(flowChart("pb71", "2028-01-01"));
    expect(before).not.toEqual(after);
  });

  it("returns null for an unknown flow", () => {
    expect(flowChart("nope")).toBeNull();
  });
});
