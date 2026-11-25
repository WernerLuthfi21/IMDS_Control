import { describe, expect, it } from "vitest";
import { detectColumns, looksLikePartNo, masterKeyFor, parseDate, parseParts, parseStatus, splitPaste, toInserts, type AddContext } from "@/lib/imds-master/part-add";
import { planPartOps, validate } from "@/lib/imds-master/part-log";

// FIXTURE supplier and part numbers.
const ctx: AddContext = { company: "FX ALPHA PARTS", vendorCode: "9001", email: "pic@alpha.test", models: ["737D", "688D"], defaultModel: "737D", defaultStatus: "NOT SUBMITTED YET", due: { models: { "737D": "2026-11-25" }, suppliers: { "FX ALPHA PARTS|688D": "2026-12-01" } } };

describe("reading pasted rows", () => {
  it("recognises part numbers, dates and statuses", () => {
    expect(["8211VKK030", "74404-KK090", "863C00K020"].every(looksLikePartNo)).toBe(true);
    expect(["WIRE, ENGINE ROOM", "30/11/2026", "737D", "12345"].some(looksLikePartNo)).toBe(false);
    expect(["2026-11-30", "30/11/2026", "30-Nov-2026", "30 Des 2026", "46356"].map(parseDate)).toEqual(["2026-11-30", "2026-11-30", "2026-11-30", "2026-12-30", "2026-11-30"]);
    expect(parseDate("31/02/2026")).toBeNull();
    expect(parseStatus("Not Submitted Yet")).toBe("NOT SUBMITTED YET");
    expect(parseStatus("rejected")).toBe("REJECTED");
  });
  it("splits Excel (tabs), semicolons or wide spaces", () => {
    expect(splitPaste("A\tB\n\nC\tD")).toEqual([["A", "B"], ["C", "D"]]);
    expect(splitPaste("A; B")).toEqual([["A", "B"]]);
    expect(splitPaste("8211VKK030   WIRE, ENGINE ROOM")).toEqual([["8211VKK030", "WIRE, ENGINE ROOM"]]);
  });
  it("uses a header row when there is one, otherwise the look of the cells", () => {
    expect(detectColumns([["Part Name", "P/No.", "Model"], ["WIRE", "8211VKK030", "737D"]], ctx.models)).toMatchObject({ header: true, partNo: 1, partName: 0, model: 2 });
    expect(detectColumns([["WIRE, ENGINE ROOM", "8211VKK030", "688D", "30/11/2026"], ["BRACKET", "51795-YP050", "737D", "01/12/2026"]], ctx.models)).toMatchObject({ header: false, partNo: 1, partName: 0, model: 2, plan: 3 });
  });
});

describe("filling what is missing and catching duplicates", () => {
  const existing = [
    { id: "1", company_name: "FX ALPHA PARTS", project: "737D", part_no: "8211VKK030", part_no_norm: "8211VKK030" },
    { id: "2", company_name: "FX OTHER SUPPLIER", project: "737D", part_no: "51795-YP050", part_no_norm: "51795YP050" }
  ];
  const text = "8211VKK030\tWIRE, ENGINE ROOM\n51795-YP050\tBRACKET, SIDE STEP\n863C00K020\tDAM, GLASS\t688D\n863C00K020\tDAM, GLASS\t688D\nhello world";
  const { rows } = parseParts(text, ctx, existing);
  it("fills model, status and plan date and says so", () => {
    expect(rows[1]).toMatchObject({ partNo: "51795-YP050", partName: "BRACKET, SIDE STEP", model: "737D", status: "NOT SUBMITTED YET", plan: "2026-11-25", errors: [] });
    expect(rows[1].filled).toEqual(["model 737D", "status NOT SUBMITTED YET", "plan 2026-11-25 (model deadline)"]);
    expect(rows[1].warnings).toEqual(["Also listed for FX OTHER SUPPLIER"]);
    expect(rows[2]).toMatchObject({ model: "688D", plan: "2026-12-01" });
    expect(rows[2].filled).toContain("plan 2026-12-01 (supplier due date)");
  });
  it("stops rows that are already in the tracker, pasted twice or have no part number", () => {
    expect(rows[0].errors).toEqual(["Already in the tracker for this supplier and model"]);
    expect(rows[3].errors).toEqual(["Pasted twice (also line 3)"]);
    expect(rows[4].errors).toEqual(["No part number found"]);
  });
  it("inserts only the clean rows, with the supplier filled in and the master-import key", () => {
    const ins = toInserts(rows, ctx, "u1", new Date("2026-11-25T00:00:00Z"));
    expect(ins.map((r) => r.part_no)).toEqual(["51795-YP050", "863C00K020"]);
    expect(ins[0]).toMatchObject({ company_name: "FX ALPHA PARTS", vendor_code: "9001", main_pic_email: "pic@alpha.test", project: "737D", part_no_norm: "51795YP050", imds_status: "NOT SUBMITTED YET", submission_plan: "2026-11-25" });
    expect(ins[0].master_key).toBe(masterKeyFor("737D", "9001", "FX ALPHA PARTS", "51795-YP050"));
    expect(ins[0].master_key).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("changing a part number", () => {
  const row = { id: "00000000-0000-4000-8000-000000000001", company_name: "FX ALPHA PARTS", project: "737D", part_no: "8211VKK030", part_name: "WIRE", imds_status: "WORKING" };
  it("needs one part and a real new number", () => {
    expect(validate("renumber", [row.id, row.id], { partNo: "8211VKK031" })).toMatch(/one part number at a time/);
    expect(validate("renumber", [row.id], { partNo: "x" })).toMatch(/at least 5/);
    expect(validate("renumber", [row.id], { partNo: "8211VKK031" })).toBeNull();
  });
  it("updates number (and name), keeps the status, logs the old number", () => {
    const p = planPartOps("renumber", [row], { checks: {}, events: [] }, { partNo: " 8211vkk031 ", partName: "WIRE, ENGINE ROOM", reason: "ECI update" }, "me", new Date("2026-11-25T00:00:00Z"));
    expect(p.updates).toEqual([{ id: row.id, patch: { part_no: "8211VKK031", part_no_norm: "8211VKK031", part_name: "WIRE, ENGINE ROOM" } }]);
    expect(p.log.events[0]).toMatchObject({ action: "renumber", reason: "ECI update", before: { partNo: "8211VKK030", status: "WORKING" }, after: { partNo: "8211VKK031" } });
    expect(planPartOps("renumber", [row], { checks: {}, events: [] }, { partNo: "8211VKK030" }, "me", new Date()).updates).toEqual([]);
  });
});
