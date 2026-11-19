import { describe, expect, it } from "vitest";
import { lookupSubstance } from "@/lib/reference-data";

const group = (cas: string) => lookupSubstance(cas).tszGroups.map((t) => String(t.values?.[1]));

describe("Appendix 3 element families (\"<element> and its compounds, all members\", CAS Various)", () => {
  it("finds the family for the element itself", () => {
    expect(group("7439-92-1")).toEqual(["20"]);   // Lead
    expect(group("7440-43-9")).toEqual(["5"]);    // Cadmium
    expect(group("7439-97-6")).toEqual(["21"]);   // Mercury
  });
  it("finds the family for its compounds", () => {
    expect(group("1317-36-8")).toEqual(["20"]);   // Lead monoxide
  });
  it("keeps CAS matches first and leaves non-members alone", () => {
    expect(group("1333-82-0")).toEqual(["10"]);   // Chromium(VI) trioxide, listed by CAS
    expect(group("7440-02-0")).toEqual([]);       // Nickel is not a TSZ0001G group
    expect(lookupSubstance("7439-92-1").tszMatchedBy).toBe("group-name");
  });
});
