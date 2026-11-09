import { describe, expect, it } from "vitest";
import { fixedPartNo, mapMdStatusToImds, planCandidatePatch, selectCurrentMd, type CandidateState, type MdItem } from "@/lib/imds-master/md-current";

const item = (o: Partial<MdItem> & { idVersion: string; status: string }, i = 1): MdItem => ({
  lastStatusChanged: null, lastStatusChangedAt: null, reasonForDenial: null, rowNo: i, ...o
});
const state = (o: Partial<CandidateState> = {}): CandidateState => ({
  imds_status: "NOT SUBMITTED YET", imds_id_version: null, md_status_update_date: null, manual_overrides: [], extra_fields: {}, ...o
});

describe("selectCurrentMd (real cases from the MD System export)", () => {
  it("681010K160: cancelled v1 listed AFTER live v2 must not win", () => {
    // export order: v2 in process (01:54:18), then v1 cancelled (01:55:08, later timestamp)
    const r = selectCurrentMd([
      item({ idVersion: "1533401270 / 2", status: "in process at recipient", lastStatusChanged: "2026-10-19", lastStatusChangedAt: "2026-10-19T01:54:18Z" }, 1),
      item({ idVersion: "1533401270 / 1", status: "cancelled by sender", lastStatusChanged: "2026-10-19", lastStatusChangedAt: "2026-10-19T01:55:08Z" }, 2)
    ]);
    expect(r.chosen.idVersion).toBe("1533401270 / 2");
    expect(r.ambiguity).toBeNull();
  });

  it("two live IMDS IDs for one part are flagged, never guessed (517800K170 pattern)", () => {
    const r = selectCurrentMd([
      item({ idVersion: "1534289395 / 1", status: "in process at recipient", lastStatusChangedAt: "2026-10-22T04:59:24Z", lastStatusChanged: "2026-10-22" }, 1),
      item({ idVersion: "867650290 / 1", status: "in process at recipient", lastStatusChangedAt: "2026-10-21T08:20:57Z", lastStatusChanged: "2026-10-21" }, 2)
    ]);
    expect(r.ambiguity).toBe("MULTI_ID");
  });

  it("a cancelled record of a DIFFERENT ID does not hide the live accepted one (63141VT030)", () => {
    const r = selectCurrentMd([
      item({ idVersion: "1526445014 / 1", status: "cancelled by sender", lastStatusChangedAt: "2026-09-15T05:59:18Z", lastStatusChanged: "2026-09-15" }, 1),
      item({ idVersion: "1525983695 / 1", status: "accepted", lastStatusChangedAt: "2026-09-14T10:05:17Z", lastStatusChanged: "2026-09-14" }, 2)
    ]);
    expect(r.chosen.status).toBe("accepted");
    expect(r.ambiguity).toBeNull();
  });

  it("all cancelled -> returns the cancelled record (mapped to review later)", () => {
    expect(selectCurrentMd([item({ idVersion: "1 / 1", status: "cancelled by sender" })]).chosen.status).toBe("cancelled by sender");
  });

  it("higher version with an older timestamp is a conflict, not a silent pick", () => {
    const r = selectCurrentMd([
      item({ idVersion: "9 / 1", status: "rejected", lastStatusChangedAt: "2026-10-02T10:00:00Z", lastStatusChanged: "2026-10-02" }, 1),
      item({ idVersion: "9 / 2", status: "in process at recipient", lastStatusChangedAt: "2026-10-01T10:00:00Z", lastStatusChanged: "2026-10-01" }, 2)
    ]);
    expect(r.ambiguity).toBe("VERSION_DATE_CONFLICT");
  });
});

describe("part number and status mapping", () => {
  it("fixedPartNo strips the design-change suffix and spaces", () => {
    expect(fixedPartNo("82172KK010D")).toBe("82172KK010");
    expect(fixedPartNo("55514KK110 D")).toBe("55514KK110");
    expect(fixedPartNo("63126KK0101")).toBe("63126KK010");
    expect(fixedPartNo("755610D100")).toBe("755610D100");
  });
  it("maps only what the real master evidences; everything else is left to a human", () => {
    expect(mapMdStatusToImds("accepted")).toBe("ACCEPTED");
    expect(mapMdStatusToImds("in process at recipient")).toBe("TMMIN WORKING");
    expect(mapMdStatusToImds("not yet browsed")).toBe("TMMIN WORKING");
    expect(mapMdStatusToImds("rejected")).toBe("REJECTED");
    expect(mapMdStatusToImds("cancelled by sender")).toBeNull();
    expect(mapMdStatusToImds("modified")).toBeNull();
  });
});

describe("planCandidatePatch", () => {
  const live = item({ idVersion: "1525320002 / 1", status: "accepted", lastStatusChanged: "2026-10-20", lastStatusChangedAt: "2026-10-20T03:00:00Z" });

  it("updates mirror columns AND derives imds_status + id/version", () => {
    const p = planCandidatePatch(state(), [live]);
    expect(p.patch).toMatchObject({ status_update: "accepted", md_id_version: "1525320002 / 1", md_status_update_date: "2026-10-20", imds_status: "ACCEPTED", imds_id_version: "1525320002 / 1" });
    expect(p.review).toEqual([]);
  });

  it("a manual override is never touched (imds_status stays, mirror still updates)", () => {
    const p = planCandidatePatch(state({ manual_overrides: ["imds_status"] }), [live]);
    expect(p.patch).not.toHaveProperty("imds_status");
    expect(p.patch.status_update).toBe("accepted");
  });

  it("DEAD (NEW SMS) / NOT TO BE COLLECTED are kept and flagged", () => {
    for (const s of ["DEAD (NEW SMS)", "NOT TO BE COLLECTED"]) {
      const p = planCandidatePatch(state({ imds_status: s }), [live]);
      expect(p.patch).not.toHaveProperty("imds_status");
      expect(p.review[0]).toMatch(/PROTECTED_STATUS_KEPT/);
    }
  });

  it("ACCEPTED is not downgraded when the ID version did not change", () => {
    const p = planCandidatePatch(state({ imds_status: "ACCEPTED", imds_id_version: "1525320002 / 1" }), [item({ idVersion: "1525320002 / 1", status: "in process at recipient", lastStatusChanged: "2026-10-21", lastStatusChangedAt: "2026-10-21T03:00:00Z" })]);
    expect(p.patch).not.toHaveProperty("imds_status");
    expect(p.review[0]).toMatch(/ACCEPTED_DOWNGRADE/);
  });

  it("a higher version of the same ID is a revision: the status may move off ACCEPTED and the revision is recorded", () => {
    const p = planCandidatePatch(state({ imds_status: "ACCEPTED", imds_id_version: "1525320002 / 1" }), [item({ idVersion: "1525320002 / 2", status: "in process at recipient", lastStatusChanged: "2026-10-21", lastStatusChangedAt: "2026-10-21T03:00:00Z" })]);
    expect(p.patch.imds_status).toBe("TMMIN WORKING");
    expect(p.patch.md_id_version).toBe("1525320002 / 2");
    expect((p.patch.extra_fields as Record<string, unknown>).revision).toMatchObject({ from: "1525320002 / 1", to: "1525320002 / 2", previousStatus: "ACCEPTED" });
    expect(p.review).toEqual([]);
  });

  it("status only moves up for the same version: working -> accepted, rejected -> working", () => {
    expect(planCandidatePatch(state({ imds_status: "TMMIN WORKING" }), [item({ status: "accepted" })]).patch.imds_status).toBe("ACCEPTED");
    expect(planCandidatePatch(state({ imds_status: "REJECTED" }), [item({ status: "in process at recipient" })]).patch.imds_status).toBe("TMMIN WORKING");
  });

  it("an OLD export cannot roll the master back", () => {
    const p = planCandidatePatch(state({ md_status_update_date: "2026-10-25", imds_status: "ACCEPTED" }), [live]);
    expect(p.stale).toBe(true);
    expect(p.patch).toEqual({});
  });

  it("re-importing the same file is a no-op for status and id (idempotent)", () => {
    const p = planCandidatePatch(state({ imds_status: "ACCEPTED", imds_id_version: "1525320002 / 1", md_status_update_date: "2026-10-20" }), [live]);
    expect(p.patch).not.toHaveProperty("imds_status");
    expect(p.patch).not.toHaveProperty("imds_id_version");
  });

  it("a different IMDS ID number typed by hand is flagged, not overwritten", () => {
    const p = planCandidatePatch(state({ imds_id_version: "999 / 1" }), [live]);
    expect(p.patch).not.toHaveProperty("imds_id_version");
    expect(p.review[0]).toMatch(/ID_NUMBER_DIFFERS/);
  });

  it("ambiguous parts change nothing except the review flag", () => {
    const p = planCandidatePatch(state(), [
      item({ idVersion: "1 / 1", status: "accepted", lastStatusChangedAt: "2026-10-22T04:00:00Z", lastStatusChanged: "2026-10-22" }, 1),
      item({ idVersion: "2 / 1", status: "accepted", lastStatusChangedAt: "2026-10-21T04:00:00Z", lastStatusChanged: "2026-10-21" }, 2)
    ]);
    expect(Object.keys(p.patch)).toEqual(["extra_fields"]);
    expect((p.patch.extra_fields as { mdReview: { reasons: string[] } }).mdReview.reasons[0]).toMatch(/MULTI_ID/);
  });

  it("a later clean import clears the review flag", () => {
    const p = planCandidatePatch(state({ extra_fields: { mdReview: { reasons: ["x"] }, keep: 1 } }), [live]);
    expect(p.patch.extra_fields).toEqual({ keep: 1 });
  });
});
