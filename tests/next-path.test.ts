import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/security/next-path";

describe("safeNextPath", () => {
  it("keeps same-origin relative paths", () => {
    expect(safeNextPath("/judgement?q=abc")).toBe("/judgement?q=abc");
    expect(safeNextPath("/imds-tracker")).toBe("/imds-tracker");
  });
  it.each(["//evil.com", "/\\evil.com", "https://evil.com", "javascript:alert(1)", "", undefined, null, 42, "/login?next=/x"])(
    "falls back for unsafe value %s",
    (value) => expect(safeNextPath(value)).toBe("/workspace")
  );
});
