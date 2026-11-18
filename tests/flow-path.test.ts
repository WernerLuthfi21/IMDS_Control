import { describe, expect, it } from "vitest";
import { runAutoWorkflow } from "@/lib/judgement/auto";
import { extractRowFacts } from "@/lib/judgement/row-facts";
import { flowChart, type FlowChartNode } from "@/lib/judgement/flows";
import { decodeTrail, encodeTrail, tracePath } from "@/lib/judgement/flow-path";

const at = (root: FlowChartNode, key: string): FlowChartNode => key.split(".").slice(1).reduce((n, i) => n.branches[Number(i)].node, root);
const elv = (app: string, pct: string) => extractRowFacts({ "Application ID [col 32]": app, "Substance Content(%) [col 31]": pct, "Material Name [col 26]": "Steel" });

describe("tracePath: a case's evaluation trail on the drawn flow chart", () => {
  it("follows checks answered automatically from the row (wording differs from the chart)", () => {
    const r = runAutoWorkflow({ errorType: "ELV (Cd)", facts: elv("44", "0.005") });
    expect(r.flow?.flowId).toBe("elvCd");
    const chart = flowChart("elvCd")!;
    const p = tracePath(chart.root, r.flow!.trail);
    expect(p.complete).toBe(true);
    expect(at(chart.root, p.nodes.at(-1)!).outcome?.state).toBe("OK");
    expect(p.matched).toBe(r.flow!.trail.length);
  });
  it("follows supplier answers to an NG", () => {
    const r = runAutoWorkflow({ errorType: "ELV (Cd)", facts: elv("20", "0.005"), answers: { supplier: "A" } });
    const chart = flowChart("elvCd")!;
    const p = tracePath(chart.root, r.flow!.trail);
    expect(p.complete).toBe(true);
    expect(at(chart.root, p.nodes.at(-1)!).outcome?.state).toBe("NG");
  });
  it("stops at the open question of an unfinished case and never guesses further", () => {
    const r = runAutoWorkflow({ errorType: "ELV (Cd)", facts: elv("20", "0.005") });
    const chart = flowChart("elvCd")!;
    const p = tracePath(chart.root, r.flow!.trail);
    expect(p.complete).toBe(false);
    expect(at(chart.root, p.nodes.at(-1)!).question?.id).toBe("supplier");
  });
  it("stops when an answer does not exist on the chart", () => {
    const chart = flowChart("pfoa")!;
    const p = tracePath(chart.root, [{ question: "Confirm to supplier", answer: "Z · Unknown" }]);
    expect(p).toMatchObject({ nodes: ["r"], matched: 0, complete: false });
  });
  it("walks a multi-step manual path (PFOA, EU, below 25ppb → OK)", () => {
    const chart = flowChart("pfoa")!;
    const p = tracePath(chart.root, [
      { question: "Confirm to supplier", answer: "B · It contains" },
      { question: "Vehicle destination", answer: "EU" },
      { question: "Is the total of PFOAs below 0.0000025wt% (25ppb) in the material?", answer: "Yes" }
    ]);
    expect(p.complete).toBe(true);
    expect(at(chart.root, p.nodes.at(-1)!).outcome?.state).toBe("OK");
  });
  it("encodes a trail for the URL and decodes it back (unicode safe, junk ignored)", () => {
    const t = [{ question: "Below 0.01wt%? (≤ limit)", answer: "0.005 from the row → Yes" }];
    const back = decodeTrail(encodeTrail(t));
    expect(back).toEqual([{ question: t[0].question, answer: "yes" }]);
    expect(decodeTrail("%%%not-base64")).toEqual([]);
    expect(decodeTrail(null)).toEqual([]);
  });
});
