import { describe, expect, it } from "vitest";
import { ROLE_LOOP_MIGRATION, friendlyImportError } from "@/lib/import-errors";

describe("friendly import errors", () => {
  it("explains the Storage 54001 error and names the fix", () => {
    expect(friendlyImportError(new Error("database error, code: 54001"))).toContain(ROLE_LOOP_MIGRATION);
    expect(friendlyImportError("stack depth limit exceeded")).toMatch(/nothing was imported/);
  });
  it("explains unreadable OneDrive files", () => {
    const e = new Error("The requested file could not be read, typically due to permission problems"); e.name = "NotReadableError";
    expect(friendlyImportError(e)).toMatch(/Always keep on this device/);
  });
  it("passes other messages through", () => {
    expect(friendlyImportError(new Error("Only STAGED batches may be committed"))).toBe("Only STAGED batches may be committed");
    expect(friendlyImportError(new TypeError("Failed to fetch"))).toMatch(/connection dropped/);
  });
});
