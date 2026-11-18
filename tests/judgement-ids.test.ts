import { describe, expect, it } from "vitest";
import { MAX_IDS_PER_REQUEST, uniqueById, validIds } from "@/lib/judgement/ids";

const A = "3f2b8c1e-5d4a-4b7e-9c2d-1a2b3c4d5e6f";
const B = "7a1c9e2f-0b3d-4e5f-8a6b-9c0d1e2f3a4b";

describe("validIds", () => {
  it("accepts unique UUIDs in order", () => {
    expect(validIds([A, B])).toEqual([A, B]);
  });
  it("collapses duplicates instead of rejecting the request", () => {
    expect(validIds([A, B, A])).toEqual([A, B]);
  });
  it("rejects empty, non-array, non-UUID and oversized input", () => {
    expect(validIds([])).toBeNull();
    expect(validIds("x")).toBeNull();
    expect(validIds([A, "not-a-uuid"])).toBeNull();
    expect(validIds([A, 1])).toBeNull();
    expect(validIds(Array(MAX_IDS_PER_REQUEST + 1).fill(A))).toBeNull();
  });
});

describe("uniqueById", () => {
  it("keeps the first row per id", () => {
    const rows = [{ id: A, n: 1 }, { id: B, n: 2 }, { id: A, n: 3 }];
    expect(uniqueById(rows)).toEqual([{ id: A, n: 1 }, { id: B, n: 2 }]);
  });
});
