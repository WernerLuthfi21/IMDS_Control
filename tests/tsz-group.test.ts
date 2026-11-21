import { describe, expect, it } from "vitest";
import { lookupSubstance } from "@/lib/reference-data";

describe("Appendix 3 'all members' groups", () => {
  it("finds the PCB group through the GADSL family when the CAS is not listed, and its POPs rows", () => {
    const l = lookupSubstance("1336-36-3");
    expect(l.tszMatchedBy).toBe("gadsl-family");
    expect(String(l.tszGroups[0].values?.[2])).toMatch(/Polychlorinated biphenyls/);
    expect(l.pops.length).toBeGreaterThan(0);
  });
  it("still prefers a direct CAS match and never invents a group", () => {
    expect(lookupSubstance("117-81-7").tszMatchedBy).toBe("cas");
    expect(lookupSubstance("13463-67-7").tszMatchedBy).toBeNull();
  });
});
