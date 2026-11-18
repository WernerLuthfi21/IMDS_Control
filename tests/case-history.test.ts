import { describe, expect, it } from "vitest";
import { buildTimeline, fromChangeLog, fromCurrentState, fromEscalations, fromSnapshots, isMissingTable } from "@/lib/judgement/history";

const snap = (batch: string, at: string, n: Record<string, unknown>) => ({ batch_id: batch, file_name: batch + ".xlsx", committed_at: at, created_at: at, source_sheet: "Sheet1", source_row: 12, normalized: n });
const none = () => null;

describe("case history timeline (existing records only)", () => {
  it("snapshots: first import, then field-level differences, then gaps that say the case was kept", () => {
    const ev = fromSnapshots([
      snap("b2", "2026-11-10T02:00:00Z", { sourceStatus: "WORKING", comment: "Ask supplier" }),
      snap("b1", "2026-11-01T02:00:00Z", { sourceStatus: "WORKING", comment: "" }),
      snap("b3", "2026-11-12T02:00:00Z", { sourceStatus: "WORKING", comment: "Ask supplier" })
    ], [{ id: "b4", file_name: "b4.xlsx", committed_at: "2026-11-15T02:00:00Z" }, { id: "b0", file_name: "b0.xlsx", committed_at: "2026-10-01T02:00:00Z" }]);
    expect(ev.map((e) => e.title)).toEqual(["First imported from G-CATS", "G-CATS snapshot changed this case", "Seen again in G-CATS snapshot", "Not in this G-CATS snapshot"]);
    expect(ev[1].detail).toMatch(/Comment \(last time\): — → Ask supplier/);
    expect(ev[3].detail).toMatch(/kept, not deleted/);
  });
  it("change log: automatic finals are attributed to the system, people to their name, reasons from the audit row", () => {
    const ev = fromChangeLog([
      { id: "1", actor_id: "u1", changed_columns: ["judge", "ok_comment", "judge_override"], before_values: { judge: null }, after_values: { judge: "OK", ok_comment: "Below threshold" }, created_at: "2026-11-11T01:00:00Z" },
      { id: "2", actor_id: "u2", changed_columns: ["judge", "assigned_person"], before_values: { judge: null }, after_values: { judge: "NG", assigned_person: "Auto-judgement (System)" }, created_at: "2026-11-12T01:00:00Z" },
      { id: "3", actor_id: "u2", changed_columns: ["judge"], before_values: { judge: "NG" }, after_values: { judge: null }, created_at: "2026-11-13T01:00:00Z" }
    ], [
      { id: "a3", actor_id: "u2", action: "JUDGEMENT_AUTO_REOPENED", metadata: { reason: "Wrong destination" }, created_at: "2026-11-13T01:00:02Z" },
      { id: "a9", actor_id: "u1", action: "KM_JUDGEMENT_UPDATED", metadata: {}, created_at: "2026-11-14T01:00:00Z" }
    ], (id) => id === "u1" ? "Jasmine" : null);
    expect(ev[0]).toMatchObject({ kind: "judgement", title: "Judged OK", actor: "Jasmine" });
    expect(ev[0].detail).not.toMatch(/override/);
    expect(ev[1]).toMatchObject({ kind: "system", title: "Judged NG automatically", actor: "Auto-judgement (System)" });
    expect(ev[2]).toMatchObject({ title: "Automatic judgement reopened" });
    expect(ev[2].detail).toMatch(/Reason: Wrong destination/);
    expect(ev[3]).toMatchObject({ source: "audit_events", title: "KM/TMA judgement updated" });
  });
  it("a judge value without any log entry is shown as coming from the source, never as a person's action", () => {
    const item = { judge: "OK", km_judge: null, source_judge_label: "OK", source_km_judge_label: null, last_change_date: "2026-10-30", starting_date: "2026-10-01", last_comment: "prev comment" };
    const ev = fromCurrentState(item, []);
    expect(ev[0]).toMatchObject({ title: "Judge OK taken from the G-CATS source", at: "2026-10-30", precision: "date", actor: null });
    expect(ev.find((e) => e.id === "now:lastcomment")).toMatchObject({ at: null, precision: "none" });
    expect(fromCurrentState(item, [{ id: "log:1", at: "x", precision: "timestamp", kind: "judgement", title: "Judged OK", detail: "", actor: null, source: "register_change_log" }]).some((e) => e.id === "now:judge")).toBe(false);
  });
  it("orders by time with dates as the start of the Jakarta day, undated events last, duplicates dropped", () => {
    const t = buildTimeline([
      [{ id: "c", at: null, precision: "none", kind: "import", title: "c", detail: "", actor: null, source: "x" }],
      [{ id: "b", at: "2026-11-01T00:30:00Z", precision: "timestamp", kind: "reviewer", title: "b", detail: "", actor: null, source: "x" }],
      [{ id: "a", at: "2026-11-01", precision: "date", kind: "import", title: "a", detail: "", actor: null, source: "x" }, { id: "a", at: "2026-11-01", precision: "date", kind: "import", title: "a", detail: "", actor: null, source: "x" }]
    ]);
    expect(t.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });
  it("escalation history entries become reviewer events; missing-table errors are recognised", () => {
    const ev = fromEscalations([{ id: "e", history: [{ at: "2026-11-02T00:00:00Z", by: "Werner", status: "SENT" }, { at: "2026-11-03T00:00:00Z", by: "Werner", status: "CONFIRMED", answer: "OK", note: "TMC ok" }, { status: "NEED" }] }]);
    expect(ev.map((e) => e.title)).toEqual(["Sent to TMC", "TMC answered OK"]);
    expect(isMissingTable({ code: "PGRST205" })).toBe(true);
    expect(isMissingTable({ code: "42501", message: "permission denied" })).toBe(false);
    expect(none()).toBeNull();
  });
});
