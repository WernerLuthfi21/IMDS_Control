import { describe, expect, it } from "vitest";
import { normalizeCas, resolveSubstance } from "@/lib/judgement/substance-resolver";

describe("automatic CAS → GADSL → TSZ → appendices resolver", () => {
  it("normalizes formatting, preserves leading zeroes and rejects invalid checksum", () => {
    expect(normalizeCas("0117-81-7")).toBe("0117-81-7");
    expect(resolveSubstance("117-81-8").status).toBe("INVALID_CAS");
  });

  it("resolves DEHP to TSZ group 30 and its REACH appendix rows", () => {
    const result = resolveSubstance("117-81-7");
    expect(result.casNormalized).toBe("117-81-7");
    expect(result.tszGroups.map(group => group.tszNo)).toContain("30");
    expect(result.familyFlows).toContain("REACH Annex XVII");
    expect(result.appendices.some(row => row.appendix === "6")).toBe(true);
    expect(result.remainingRequirements).toContain("Select destination code from the approved G-CATS destination list");
  });

  it("keeps valid but unlisted CAS values out of automatic OK/NG decisions", () => {
    const result = resolveSubstance("999-99-5");
    expect(result.status).toBe("NO_REFERENCE_MATCH");
    expect(result.remainingRequirements.length).toBeGreaterThan(0);
  });
});
