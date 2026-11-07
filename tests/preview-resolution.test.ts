import { describe, expect, it } from "vitest";
import { detectColumns } from "@/lib/intake/detect";
import { cellIssues, problemRows } from "@/lib/intake/preview";
import { byPart, readiness } from "@/lib/intake/resolution";
import type { AnalyzedRow } from "@/lib/intake/analyze";

const m = [["Part No.", "CAS No.", "Content %"], ["A1", "7439-92-1", "0.1"], ["", "7440-43-9", "abc"], ["A1", "7439-92-1", "0.1"]];
const row = (state: string, partNo: string) => ({ state, partNo, issues: [], reason: "", comment: "", ask: [], answered: {} }) as unknown as AnalyzedRow;

describe("preview", () => {
  it("flags empty part, non-numeric content and duplicates", () => {
    const det = detectColumns(m); const i = cellIssues(m, det);
    expect(Array.from(i.values()).some((x) => x.text === "Part No. is empty")).toBe(true);
    expect(Array.from(i.values()).some((x) => /not a number/.test(x.text))).toBe(true);
    expect(problemRows(i).size).toBeGreaterThan(0);
  });
});
describe("resolution", () => {
  it("rolls up worst state per part and readiness", () => {
    const p = byPart([row("OK", "A"), row("NG", "A"), row("OK", "B")]);
    expect(p[0].partNo).toBe("A"); expect(p[0].worst).toBe("NG");
    expect(readiness([row("ASK", "A")]).ready).toBe(false);
    expect(readiness([row("NG", "A"), row("OK", "B")]).ready).toBe(true);
    expect(readiness([]).ready).toBe(false);
  });
});
