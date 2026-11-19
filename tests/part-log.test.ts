import { describe, expect, it } from "vitest";
import { CHECK_STATUS, STOP_STATUS, groupUpdates, isCheckStatus, isStopStatus, lastStop, planPartOps, sanitizePartLog, validate, type MasterRow, type PartLog } from "@/lib/imds-master/part-log";

// FIXTURE rows: invented suppliers and part numbers.
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const row = (id: string, over: Partial<MasterRow> = {}): MasterRow => ({ id, company_name: "FX SUPPLIER ONE", vendor_code: "9001", project: "737D", part_no: "FX-1", part_name: "PART (FIXTURE)", imds_status: "NOT SUBMITTED YET", submission_plan: "2026-10-26", main_pic_email: "pic@fixture.test", ...over });
const empty: PartLog = { checks: {}, events: [] };
const now = new Date("2026-11-19T08:00:00Z");

describe("target dates", () => {
  it("sets the date on every part that differs and skips the ones already on it", () => {
    const p = planPartOps("set-target", [row(A), row(B, { submission_plan: "2026-11-30" })], empty, { date: "2026-11-30" }, "me", now);
    expect(p.updates).toEqual([{ id: A, patch: { submission_plan: "2026-11-30" } }]);
    expect(p.logChanged).toBe(false);
  });
  it("can clear a date and rejects a malformed one", () => {
    expect(planPartOps("set-target", [row(A)], empty, { date: null }, "me", now).updates[0].patch).toEqual({ submission_plan: null });
    expect(validate("set-target", [A], { date: "30/11/2026" })).toMatch(/YYYY-MM-DD/);
  });
});

describe("Check tab", () => {
  it("moving to Check remembers the supplier, model and status it came from", () => {
    const p = planPartOps("to-check", [row(A)], empty, { reason: "Supplier says not theirs" }, "me", now);
    expect(p.updates[0].patch).toEqual({ imds_status: CHECK_STATUS });
    expect(p.log.checks[A].from).toMatchObject({ company: "FX SUPPLIER ONE", model: "737D", status: "NOT SUBMITTED YET" });
    expect(p.log.events.at(-1)).toMatchObject({ id: A, action: "to-check", reason: "Supplier says not theirs" });
  });
  it("resolving with the correct supplier returns the part with its old status and hands the status back to Excel", () => {
    const moved = planPartOps("to-check", [row(A)], empty, {}, "me", now).log;
    const p = planPartOps("resolve", [row(A, { imds_status: "CHECK" })], moved, { company: "FX SUPPLIER TWO", vendorCode: "9002", email: "two@fixture.test" }, "me", now);
    expect(p.updates[0]).toEqual({ id: A, patch: { imds_status: "NOT SUBMITTED YET", company_name: "FX SUPPLIER TWO", vendor_code: "9002", main_pic_email: "two@fixture.test" }, release: ["imds_status"] });
    expect(p.log.checks[A]).toBeUndefined();
    expect(p.log.events.at(-1)).toMatchObject({ action: "resolve", before: { company: "FX SUPPLIER ONE", status: "NOT SUBMITTED YET" }, after: { company: "FX SUPPLIER TWO" } });
  });
  it("resolving with the correct model only changes the model; a chosen status wins", () => {
    const p = planPartOps("resolve", [row(A, { imds_status: "CHECK" })], empty, { model: "688D", status: "rejected" }, "me", now);
    expect(p.updates[0].patch).toEqual({ imds_status: "REJECTED", project: "688D" });
  });
  it("a part imported as CHECK (no earlier status) goes back as Not Submitted Yet", () => {
    expect(planPartOps("resolve", [row(A, { imds_status: "Cek" })], empty, { model: "688D" }, "me", now).updates[0].patch.imds_status).toBe("NOT SUBMITTED YET");
  });
  it("resolve may return a part unchanged, but only to a known status", () => {
    expect(validate("resolve", [A], {})).toBeNull();
    expect(validate("resolve", [A], { status: "DELETED" })).toMatch(/cannot be chosen/);
  });
});

describe("Stop run", () => {
  it("logs the last identity before the stop, including the status it had before Check", () => {
    const moved = planPartOps("to-check", [row(A, { imds_status: "WORKING" })], empty, {}, "me", now).log;
    const p = planPartOps("stop-run", [row(A, { imds_status: "CHECK" })], moved, { reason: "Model discontinued" }, "me", now);
    expect(p.updates[0].patch).toEqual({ imds_status: STOP_STATUS });
    expect(lastStop(p.log, A)).toMatchObject({ reason: "Model discontinued", before: { company: "FX SUPPLIER ONE", vendorCode: "9001", model: "737D", partNo: "FX-1", status: "WORKING", targetDate: "2026-10-26", email: "pic@fixture.test" } });
    expect(p.log.checks[A]).toBeUndefined();
  });
  it("needs a reason, and restore brings the old status back", () => {
    expect(validate("stop-run", [A], {})).toMatch(/why/);
    const stopped = planPartOps("stop-run", [row(A, { imds_status: "WORKING" })], empty, { reason: "x" }, "me", now).log;
    const back = planPartOps("restore", [row(A, { imds_status: STOP_STATUS })], stopped, {}, "me", now);
    expect(back.updates[0]).toEqual({ id: A, patch: { imds_status: "WORKING" }, release: ["imds_status"] });
    expect(lastStop(back.log, A)).toBeNull();
  });
});

describe("helpers", () => {
  it("recognises the special statuses", () => {
    expect(isCheckStatus(" cek ")).toBe(true); expect(isCheckStatus("checked out")).toBe(false);
    expect(isStopStatus("Stop-Run")).toBe(true); expect(isStopStatus("STOP")).toBe(false);
  });
  it("keeps app edits in manual_overrides and releases the status", () => {
    const g = groupUpdates([{ id: A, patch: { submission_plan: "2026-11-30" } }, { id: B, patch: { submission_plan: "2026-11-30" } }], () => ["comment"]);
    expect(g).toEqual([{ ids: [A, B], patch: { submission_plan: "2026-11-30", manual_overrides: ["comment", "submission_plan"] } }]);
    const r = groupUpdates([{ id: A, patch: { imds_status: "WORKING" }, release: ["imds_status"] }], () => ["imds_status", "project"]);
    expect(r[0].patch.manual_overrides).toEqual(["project"]);
  });
  it("sanitises a stored log and drops junk", () => {
    const s = sanitizePartLog({ checks: { bad: {}, [A]: { at: "t", from: { company: "X", targetDate: "nope" } } }, events: [{ id: A, action: "explode" }, { id: A, action: "stop-run", before: {} }] });
    expect(Object.keys(s.checks)).toEqual([A]);
    expect(s.checks[A].from.targetDate).toBe("");
    expect(s.events).toHaveLength(1);
  });
});
