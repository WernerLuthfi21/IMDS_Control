import { describe, expect, it } from "vitest";
import { derivedSourceCode, recordKey, sourceDate } from "@/lib/judgement/source-key";

describe("G-CATS row identity when TMA has not given a code yet", () => {
  it("reads the date formats the Error Log uses", () => {
    expect(sourceDate(new Date("2026-10-06T00:00:00Z"))).toBe("2026-10-06");
    expect(sourceDate("2026-10-06T00:00:00.000Z")).toBe("2026-10-06");
    expect(sourceDate("2026/11/05")).toBe("2026-11-05");
    expect(sourceDate(46331)).toBe("2026-11-05");
    expect(sourceDate("05/11/2026")).toBeNull();
    expect(sourceDate("2026/13/05")).toBeNull();
  });
  it("derives the same code TMA gives: Download Date + No. padded to 3", () => {
    expect(derivedSourceCode("2026/10/05", 3)).toBe("20261005003");
    expect(derivedSourceCode("2026-11-18", "7")).toBe("20261118007");
    expect(derivedSourceCode("2026-11-18", 0)).toBeNull();
    expect(derivedSourceCode("2026-11-18", 1000)).toBeNull();
    expect(derivedSourceCode(null, 5)).toBeNull();
  });
  it("TMA's code wins; blank code uses the derived key; nothing usable falls back", () => {
    expect(recordKey("20261005003", "2026/10/05", 3, "fb")).toEqual({ key: "code:20261005003", origin: "tma", derived: "20261005003" });
    expect(recordKey("", "2026/11/05", 12, "fb")).toEqual({ key: "code:20261105012", origin: "derived", derived: "20261105012" });
    expect(recordKey("  ", null, null, "fallback:x")).toEqual({ key: "fallback:x", origin: "fallback", derived: null });
  });
});
