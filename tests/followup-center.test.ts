import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, directoryEmails, isOutstanding, partListText, renderTemplate, resolveCc, sanitizeConfig, selectParts } from "@/lib/followup/center";

describe("which parts are chased", () => {
  it("action scope = supplier must act; working/accepted/protected are not chased", () => {
    for (const s of ["NOT SUBMITTED", "REJECTED", "", null, "Not yet submitted"]) expect(isOutstanding(s, "action")).toBe(true);
    for (const s of ["TMMIN WORKING", "ACCEPTED", "DEAD (NEW SMS)", "NOT TO BE COLLECTED"]) expect(isOutstanding(s, "action")).toBe(false);
  });
  it("all scope also includes TMMIN WORKING but never ACCEPTED or protected", () => {
    expect(isOutstanding("TMMIN WORKING", "all")).toBe(true);
    expect(isOutstanding("ACCEPTED", "all")).toBe(false);
    expect(isOutstanding("DEAD (NEW SMS)", "all")).toBe(false);
  });
  it("filters by model", () => {
    const parts = [{ project: "688D", imds_status: "NOT SUBMITTED" }, { project: "737D", imds_status: "NOT SUBMITTED" }, { project: "688D", imds_status: "ACCEPTED" }];
    expect(selectParts(parts, "action", ["688d"])).toHaveLength(1);
    expect(selectParts(parts, "action", [])).toHaveLength(2);
  });
});

describe("templates", () => {
  it("fills placeholders and leaves unknown braces alone", () => {
    expect(renderTemplate("Hi {supplier} ({count}) {x}", { supplier: "ACME", count: 3 })).toBe("Hi ACME (3) {x}");
  });
  it("shortens a long part list", () => {
    const parts = Array.from({ length: 30 }, (_, i) => ({ project: "688D", part_no: "P" + i }));
    const t = partListText(parts, 25).split("\n");
    expect(t).toHaveLength(26);
    expect(t[25]).toMatch(/5 part lainnya/);
  });
});

describe("config is always safe", () => {
  it("falls back to defaults and drops bad data", () => {
    const c = sanitizeConfig({ templates: [{ id: "a", name: "", subject: "s", body: "b" }], requiredCc: "ok@x.co.id; not-an-email", defaultTemplateId: "nope", maxPartsInBody: 9999, attachments: { pdf: false } });
    expect(c.templates).toEqual(DEFAULT_CONFIG.templates);
    expect(c.requiredCc).toEqual(["ok@x.co.id"]);
    expect(c.maxPartsInBody).toBe(100);
    expect(c.attachments).toEqual({ pdf: false, xlsx: true });
    expect(c.defaultTemplateId).toBe(DEFAULT_CONFIG.templates[0].id);
  });
});

describe("CC rules", () => {
  const dir = { pic: ["pic@a.id"], mid: ["spv@a.id"], top: ["md@a.id"], buyer: ["buyer@tmmin.co.id"] };
  const config = sanitizeConfig({ requiredCc: ["imds@tmmin.co.id"] });
  it("required CC is always present, even when every role is switched off", () => {
    const r = resolveCc({ to: ["pic@a.id"], supplierCc: [], directory: dir, config, roles: { mid: false, top: false, buyer: false }, extra: [] });
    expect(r.cc).toEqual(["imds@tmmin.co.id"]);
  });
  it("adds chosen management roles, extra addresses, and never repeats To or duplicates", () => {
    const r = resolveCc({ to: ["pic@a.id"], supplierCc: ["spv@a.id"], directory: dir, config, roles: { mid: true, top: true, buyer: false }, extra: ["pic@a.id", "x@y.co.id", "X@y.co.id"] });
    expect(r.cc).toEqual(["imds@tmmin.co.id", "spv@a.id", "md@a.id", "x@y.co.id"]);
  });
});

describe("directory contacts", () => {
  const directory = { entries: { "ACME INDONESIA": { name: "PT Acme Indonesia", code: "0003", f: { pic1_email: "a@acme.id", spv_email: "s@acme.id", md_email: "m@acme.id", buyer: "BDI" } } }, buyers: { BDI: { email: "bdi@tmmin.co.id" } } };
  it("matches by vendor code, then by normalized name, and reads PIC / middle / top / buyer", () => {
    for (const [code, name] of [["0003", "whatever"], ["", "ACME Indonesia, PT"]]) {
      expect(directoryEmails(directory, code, name)).toEqual({ pic: ["a@acme.id"], mid: ["s@acme.id"], top: ["m@acme.id"], buyer: ["bdi@tmmin.co.id"] });
    }
    expect(directoryEmails(directory, "9999", "Other")).toEqual({ pic: [], mid: [], top: [], buyer: [] });
  });
});
