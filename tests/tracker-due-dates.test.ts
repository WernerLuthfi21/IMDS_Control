import { describe, expect, it } from "vitest";
import { sanitizeDueDates, supplierDueKey, validIso } from "@/lib/imds-master/due-dates";
import { cleanCell } from "@/lib/imds-master/clean-cell";

describe("Tracker due dates per model and per supplier × model", () => {
  it("keeps only real calendar dates", () => {
    expect(validIso("2026-12-31")).toBe("2026-12-31");
    expect(validIso("2026-02-30")).toBeNull();
    expect(validIso("31/12/2026")).toBeNull();
    expect(validIso("")).toBeNull();
  });
  it("sanitises the stored object: bad dates and malformed supplier keys are dropped", () => {
    expect(sanitizeDueDates({ models: { "737D": "2026-12-01", X: "nope" }, suppliers: { "SUGITY CREATIVES|737D": "2026-11-30", "no-pipe": "2026-11-30", "A|B|C": "2026-11-30" }, junk: 1 }))
      .toEqual({ models: { "737D": "2026-12-01" }, suppliers: { "SUGITY CREATIVES|737D": "2026-11-30" } });
    expect(sanitizeDueDates(null)).toEqual({ models: {}, suppliers: {} });
  });
  it("supplier key is upper-cased company + model", () => {
    expect(supplierDueKey(" Sugity Creatives ", "737D")).toBe("SUGITY CREATIVES|737D");
  });
});

describe("Excel error values never reach suppliers", () => {
  it("turns #N/A in every stored shape into an empty cell", () => {
    expect(cleanCell('{"error":"#N/A"}')).toBe("");
    expect(cleanCell({ error: "#N/A" })).toBe("");
    expect(cleanCell("#REF!")).toBe("");
    expect(cleanCell({ result: 5 })).toBe("5");
    expect(cleanCell(" 12345 / 2 ")).toBe("12345 / 2");
    expect(cleanCell(null)).toBe("");
  });
});
