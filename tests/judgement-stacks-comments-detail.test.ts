import { describe, expect, it } from "vitest";
import { buildStacks, toneOf } from "@/lib/judgement/stacks";
import { buildCommentHistory, checkComment, lastComment } from "@/lib/judgement/comment-history";
import { buildPartDetails, pick } from "@/lib/judgement/gcats-detail";

describe("stacks", () => {
  it("gives each Error Type a stable colour", () => {
    expect(toneOf("Prohibited substance")).toBe("red");
    expect(toneOf("ELV (Pb)")).toBe("orange");
    expect(toneOf("WARP Part number")).toBe("violet");
    expect(toneOf("Mass check")).toBe("blue");
    expect(toneOf("Something new")).toBe(toneOf("Something new"));
  });
  it("counts decided / waiting / yours and flags full-auto stacks", () => {
    const s = buildStacks([
      { errorType: "WARP Part number", decided: true, state: "OK", waiting: false },
      { errorType: "WARP Part number", decided: true, state: "NG", waiting: false },
      { errorType: "Prohibited substance", decided: false, state: "HOLD", waiting: true },
      { errorType: "Prohibited substance", decided: false, state: "HOLD", waiting: false },
      { errorType: "Prohibited substance", decided: true, state: "OK", waiting: false }
    ]);
    expect(s.map((x) => x.errorType)).toEqual(["Prohibited substance", "WARP Part number"]);
    expect(s[0]).toMatchObject({ total: 3, decided: 1, ok: 1, waiting: 1, yours: 1, fullAuto: false });
    expect(s[1]).toMatchObject({ total: 2, decided: 2, ok: 1, ng: 1, fullAuto: true });
  });
});

describe("comment history", () => {
  const h = buildCommentHistory([
    { error_type_label: "ELV (Pb)", delivery_part_no: "P1", judge: "OK", ok_comment: "The substance is within exemption.", imds_reject_comment: null },
    { error_type_label: "ELV (Pb)", delivery_part_no: "P2", judge: "OK", ok_comment: "The substance is  within exemption.", imds_reject_comment: null },
    { error_type_label: "ELV (Pb)", delivery_part_no: "P3", judge: "OK", ok_comment: "Below threshold.", imds_reject_comment: null },
    { error_type_label: "ELV (Pb)", delivery_part_no: "P4", judge: "NG", ok_comment: null, imds_reject_comment: "Prohibited substance(s) is contained." },
    { error_type_label: "ELV (Pb)", delivery_part_no: "p9", judge: null, ok_comment: null, imds_reject_comment: null, comment_last_time: "Old G-CATS comment" }
  ]);
  it("ranks comments by use per Error Type and decision", () => {
    expect(h.byType.get("ELV (Pb)|OK")).toEqual([{ comment: "The substance is within exemption.", count: 2 }, { comment: "Below threshold.", count: 1 }]);
  });
  it("tells whether a comment matches history", () => {
    expect(checkComment(h, "ELV (Pb)", "OK", "the substance is within exemption.")).toEqual({ kind: "match", count: 2 });
    expect(checkComment(h, "ELV (Pb)", "OK", "Something else")).toEqual({ kind: "new", usual: { comment: "The substance is within exemption.", count: 2 } });
    expect(checkComment(h, "ELV (Pb)", "NG", "")).toEqual({ kind: "empty" });
  });
  it("finds the last comment for a part, G-CATS 'Comment(last time)' first", () => {
    expect(lastComment(h, "P9", "ELV (Pb)")).toBe("Old G-CATS comment");
    expect(lastComment(h, "P4", "ELV (Pb)")).toBe("Prohibited substance(s) is contained.");
    expect(lastComment(h, "X", "ELV (Pb)")).toBe("");
  });
});

describe("G-CATS detail", () => {
  const raw = {
    "Area Code [col 5]": "Z008", "Bus.Ent. [col 6]": "TMMIN", "Company Name [col 7]": "PT. Example",
    "Delivery Part Name [col 18]": "RECEIVER ASSY", "Mass(g) [col 19]": "2747.61", "Level [col 20]": "2",
    "Component Part No. [col 21]": "C0DBAYY03441", "Comment(last time) [col 9]": "***",
    "Drawing Mass(g)\nMax [col 33]": "2775", "Drawing Mass(g)\nMin [col 34]": "2775", "Drawing Info\nDrawing Status [col 40]": "With Design Change"
  };
  it("reads source values by header, ignoring column numbers, line breaks and ***", () => {
    expect(pick(raw, "Drawing Mass(g) Max")).toBe("2775");
    expect(pick(raw, "Comment(last time)")).toBe("");
    expect(pick(raw, "Missing")).toBe("");
  });
  it("builds one detail per part with header, rows and SMS block", () => {
    const d = buildPartDetails([
      { id: "1", source_record_key: "k1", error_type_label: "ELV (Pb)", delivery_part_no: "86140YYA50", supplier_code: "5148", judge: "NG", ok_comment: null, imds_reject_comment: "Contained.", raw_source: raw },
      { id: "2", source_record_key: "k2", error_type_label: "Prohibited substance", delivery_part_no: "86140yya50", supplier_code: "5148", judge: null, ok_comment: null, imds_reject_comment: null, raw_source: raw },
      { id: "3", source_record_key: "k3", error_type_label: "Mass", delivery_part_no: "A1", supplier_code: "9", judge: "OK", ok_comment: "Fine.", imds_reject_comment: null, raw_source: null }
    ]);
    expect(d).toHaveLength(2);
    const p = d.find((x) => x.header.deliveryPartNo === "86140YYA50")!;
    expect(p.header).toEqual({ areaCode: "Z008", supplierCode: "5148", deliveryPartNo: "86140YYA50", busEnt: "TMMIN", companyName: "PT. Example" });
    expect(p.rows.map((r) => [r.check, r.comment])).toEqual([["NG", "Contained."], ["", ""]]);
    expect(p).toMatchObject({ decided: 1, total: 2 });
    expect(p.sms).toMatchObject({ drawingMax: "2775", drawingMin: "2775", drawingStatus: "With Design Change" });
  });
});
