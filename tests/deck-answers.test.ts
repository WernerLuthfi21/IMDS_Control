import { describe, expect, it } from "vitest";
import { answerKey, mergeAnswer } from "@/lib/judgement/deck";
import type { CardQuestion } from "@/lib/judgement/review";

const dest: CardQuestion = { id: "destination", text: "Vehicle destination", options: [["EU", "EU"], ["KR", "KR"]], field: "destination" };
const sup: CardQuestion = { id: "supplier", text: "Confirm to supplier", options: [["A", "A"], ["B", "B"]], field: "answer" };
const base = { partNo: "12345-AB001", supplierCode: "S100", cas: "85535-85-9", errorType: "Prohibited(MCCP)" };

describe("review deck: one answer for the same question", () => {
  it("vehicle destination is shared by every card of the same delivery part", () => {
    expect(answerKey(base, dest)).toBe(answerKey({ ...base, supplierCode: "OTHER", cas: "1336-36-3", errorType: "Prohibited substance", partNo: " 12345-ab001 " }, dest));
    expect(answerKey(base, dest)).not.toBe(answerKey({ ...base, partNo: "99999-ZZ999" }, dest));
  });
  it("supplier answers are shared only for the same supplier, part, CAS and error type", () => {
    const k = answerKey(base, sup);
    expect(k).toBe(answerKey({ ...base }, sup));
    expect(k).not.toBe(answerKey({ ...base, cas: "1336-36-3" }, sup));
    expect(k).not.toBe(answerKey({ ...base, supplierCode: "S200" }, sup));
    expect(k).not.toBe(answerKey({ ...base, partNo: "99999-ZZ999" }, sup));
    expect(k).not.toBe(answerKey({ ...base, errorType: "Prohibited substance" }, sup));
  });
  it("never shares when the part or supplier is missing, or there is no question", () => {
    expect(answerKey({ ...base, partNo: null }, dest)).toBeNull();
    expect(answerKey({ ...base, supplierCode: "" }, sup)).toBeNull();
    expect(answerKey(base, null)).toBeNull();
  });
  it("merges answers into the API shape", () => {
    let a = mergeAnswer({ answers: {} }, "destination", "EU", "destination");
    a = mergeAnswer(a, "answer", "A", "supplier");
    a = mergeAnswer(a, "toleranceClass", "MC", "toleranceClass");
    expect(a).toEqual({ destination: "EU", toleranceClass: "MC", answers: { supplier: "A" } });
  });
});
