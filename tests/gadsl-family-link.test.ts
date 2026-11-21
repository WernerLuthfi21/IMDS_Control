import { describe, expect, it } from "vitest";
import { gadslFamilyChain, gadslRecords, lookupSubstance } from "@/lib/reference-data";
import { runAutoWorkflow } from "@/lib/judgement/auto";
import { extractRowFacts } from "@/lib/judgement/row-facts";

const blank = extractRowFacts({});

const tszNo = (cas: string) => lookupSubstance(cas).tszGroups.map((r) => String(r.values?.[1]));

describe("CAS → GADSL family → Appendix 3 (TSZ0001G)", () => {
  it("links a family member through GADSL # / REF # (26027-38-3 nonylphenol ethoxylate → #73)", () => {
    const l = lookupSubstance("26027-38-3");
    expect(tszNo("26027-38-3")).toEqual(["73"]);
    expect(l.tszLinks[0]).toMatchObject({ matchedBy: "gadsl-family", family: "4-Nonylphenol, branched and linear, ethoxylated, all members", caution: "" });
    expect(l.gadslFamilies[0]).toMatchObject({ gadslNumber: "160" });
    expect(l.reachAnnexXIV.length).toBeGreaterThan(0);
  });
  it("links metal compounds to their 'and its compounds' group", () => {
    expect(tszNo("1317-36-8")).toEqual(["20"]); // lead monoxide → Lead and its compounds
    expect(tszNo("7439-92-1")).toEqual(["20"]); // lead
  });
  it("follows the PFAS hierarchy ('identified in rows X to Y') to the Appendix 3 PFAS group", () => {
    expect(tszNo("335-67-1")).toEqual(["26"]);   // PFOA
    expect(tszNo("1763-23-1")).toEqual(["27"]);  // PFOS
    expect(tszNo("355-46-4")).toEqual(["28"]);   // PFHxS
    const other = gadslRecords.find((r) => r.referenceNumber === "181" && r.casOriginal)!; // "Other PFOA Related Compounds"
    expect(tszNo(other.casOriginal)).toEqual(["26"]);
    expect(gadslFamilyChain(other).map((f) => f.gadslNumber)).toEqual(["181", "173", "178"]);
  });
  it("flags a PFCAs link whose carbon range differs (Appendix 3 C9–C14 vs GADSL C9–C21)", () => {
    const l = lookupSubstance("375-95-1");
    expect(tszNo("375-95-1")).toEqual(["76"]);
    expect(l.tszLinks[0].caution).toMatch(/C9–C14.*C9–C21/);
  });
  it("splits diorganotin into dibutyltin (#59) and dioctyltin (#60) by the member name", () => {
    expect(tszNo("683-18-1")).toEqual(["59"]);
    expect(tszNo("870-08-6")).toEqual(["60"]);
  });
  it("keeps 'selected' groups with named CAS strict and leaves non-TSZ families unlinked", () => {
    expect(tszNo("71-55-6")).toContain("6");
    expect(tszNo("7440-48-4")).toEqual([]);   // cobalt: GADSL family not in TSZ0001G
    expect(tszNo("13463-67-7")).toEqual([]);  // titanium dioxide
  });
  it("a cautioned link blocks automatic finalisation (step stays MANUAL)", () => {
    const r = runAutoWorkflow({ errorType: "Prohibited substance", facts: { ...blank, cas: "375-95-1", substanceContentPct: "0.2" } });
    expect(r.steps.find((s) => s.id === "tsz")?.status).toBe("MANUAL");
  });
});
