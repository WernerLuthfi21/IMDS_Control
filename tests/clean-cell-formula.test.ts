import { describe, expect, it } from "vitest";
import { cleanCell } from "@/lib/imds-master/clean-cell";

describe("formula cells never leak as JSON text", () => {
  it("cleanCell keeps the cached result or nothing", () => {
    expect(cleanCell('{"formula":"_xlfn.XLOOKUP(A2,B:B,C:C)"}')).toBe("");
    expect(cleanCell('{"formula":"A1","result":"pic@supplier.co.id"}')).toBe("pic@supplier.co.id");
    expect(cleanCell({ formula: "A1", result: "x@y.z" })).toBe("x@y.z");
    expect(cleanCell("plain@mail.com")).toBe("plain@mail.com");
  });
});
