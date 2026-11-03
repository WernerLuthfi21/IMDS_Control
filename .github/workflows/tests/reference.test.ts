import { describe, expect, it } from "vitest";
import { isValidCas, normalizeCas, lookupSubstance, gadslRecords } from "../lib/reference-data";

describe("CAS and substance reference lookup", () => {
  it("normalizes en dash separators", () => expect(normalizeCas(" 50–00–0 ")).toBe("50-00-0"));
  it("validates CAS check digits", () => {
    expect(isValidCas("50-00-0")).toBe(true);
    expect(isValidCas("50-00-1")).toBe(false);
  });
  it("loads the packaged GADSL 2026 V1 reference", () => expect(gadslRecords.length).toBe(7285));
  it("returns source provenance for lookups", () => {
    const result = lookupSubstance("50-00-0");
    expect(result.source).toContain("GADSL Reference List 2026 V1.0 / Reference List");
  });
});
