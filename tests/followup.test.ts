import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { emailsOf, resolveRecipients, roleOf, type ContactRow } from "@/lib/followup/recipients";
import { buildSupplierEmailPayload, MAX_ATTACHMENT_BYTES, parseSenders, pickSender, SUPPLIER_EMAIL_SCHEMA } from "@/lib/followup/payload";
import { gapHoursFromEnv, recentlySent } from "@/lib/followup/guard";

const C = (supplier_code: string, email: string, contact_role: string | null, active = true): ContactRow => ({ supplier_code, email, contact_role, active });

describe("recipients (shared by Tracker and Judgement)", () => {
  it("classifies roles; a supervisor is never a PIC", () => {
    expect(roleOf("PIC")).toBe("PIC"); expect(roleOf("Main PIC 2")).toBe("PIC");
    expect(roleOf("PIC SPV")).toBe("SPV"); expect(roleOf("Marketing SPV")).toBe("SPV");
    expect(roleOf("Marketing Staff")).toBe("CC"); expect(roleOf("CC")).toBe("CC");
    expect(roleOf(null)).toBe("OTHER");
  });
  it("splits and de-duplicates messy cells (; , newline, spaces, upper-case)", () => {
    expect(emailsOf("A@X.com; b@x.com\nA@x.com , junk, 0")).toEqual(["a@x.com", "b@x.com"]);
  });
  it("Part List PIC is authoritative; directory CC/SPV are copied; to never appears in cc", () => {
    const r = resolveRecipients({ supplierCode: "T007", mainPicEmails: ["pic@a.co.id"], contacts: [C("T007", "pic@a.co.id", "PIC"), C("T007", "mkt@a.co.id", "Marketing Staff"), C("T007", "spv@a.co.id", "SPV"), C("X1", "other@z.co.id", "PIC")] });
    expect(r.to).toEqual(["pic@a.co.id"]); expect(r.cc).toEqual(["mkt@a.co.id", "spv@a.co.id"]); expect(r.source).toBe("part_list");
  });
  it("falls back to the directory PIC when the Part List cell is empty", () => {
    const r = resolveRecipients({ supplierCode: "T007", mainPicEmails: [], contacts: [C("T007", "spv@a.co.id", "SPV"), C("T007", "pic@a.co.id", "PIC")] });
    expect(r.to).toEqual(["pic@a.co.id"]); expect(r.source).toBe("directory_pic");
  });
  it("REGRESSION: the old Judgement send picked the first contact of ANY role, which could be the SPV", () => {
    const r = resolveRecipients({ supplierCode: "T007", contacts: [C("T007", "spv@a.co.id", "SPV"), C("T007", "pic@a.co.id", "PIC")] });
    expect(r.to).toEqual(["pic@a.co.id"]); expect(r.cc).toEqual(["spv@a.co.id"]);
  });
  it("only a supervisor on file => no recipient, never the supervisor", () => {
    const r = resolveRecipients({ supplierCode: "T007", contacts: [C("T007", "spv@a.co.id", "SPV")] });
    expect(r.to).toEqual([]); expect(r.source).toBe("none"); expect(r.warnings[0]).toMatch(/No PIC/);
  });
  it("a role-less legacy contact is still reachable but flagged", () => {
    const r = resolveRecipients({ supplierCode: "T007", contacts: [C("T007", "old@a.co.id", null)] });
    expect(r.to).toEqual(["old@a.co.id"]); expect(r.source).toBe("directory_other"); expect(r.warnings.length).toBe(1);
  });
  it("ignores inactive contacts and other suppliers; supplier code match is case-insensitive", () => {
    const r = resolveRecipients({ supplierCode: "t007", contacts: [C("T007", "gone@a.co.id", "PIC", false), C("T007", "pic@a.co.id", "PIC"), C("T008", "x@b.co.id", "PIC")] });
    expect(r.to).toEqual(["pic@a.co.id"]);
  });
  it("extra CC typed by the sender is added and validated", () => {
    expect(resolveRecipients({ supplierCode: "T007", mainPicEmails: ["pic@a.co.id"], contacts: [], extraCc: ["boss@x.co.id; nonsense"] }).cc).toEqual(["boss@x.co.id"]);
  });
});

describe("sender allow-list", () => {
  const allowed = parseSenders("IMDS Team <imds@x.co.id>; Budi <BUDI@x.co.id>; broken; plain@x.co.id");
  it("parses names and bare addresses, drops junk", () => {
    expect(allowed).toEqual([{ name: "IMDS Team", email: "imds@x.co.id" }, { name: "Budi", email: "budi@x.co.id" }, { name: "plain", email: "plain@x.co.id" }]);
  });
  it("honours only allow-listed senders (no spoofing); nothing requested => default account", () => {
    expect(pickSender(allowed, "BUDI@x.co.id")?.name).toBe("Budi");
    expect(pickSender(allowed, "ceo@x.co.id")).toBeNull();
    expect(pickSender(allowed, "")).toBeNull();
  });
});

describe("payload v2", () => {
  const base = { source: "tracker" as const, supplierCode: "T007", supplierName: "ADYAWINSA", subject: " S ", body: " B ", metadata: { partCount: 3, projects: ["737D"], items: 3 } };
  it("is a superset of the legacy shapes (flows built earlier keep working)", () => {
    const p = buildSupplierEmailPayload({ ...base, followupId: "f1", to: ["a@x.co.id", "b@x.co.id"], cc: ["a@x.co.id", "c@x.co.id"], attachments: [{ name: "r.pdf", contentType: "application/pdf", contentBytes: "JVBERg==" }] });
    for (const k of ["type", "followupId", "to", "cc", "subject", "body", "attachments", "files", "supplierCode", "supplierName"]) expect(p).toHaveProperty(k);
    // Teams-webhook trigger rejects non-card `attachments` with HTTP 400: files travel in `files`, `attachments` stays empty.
    expect(p.attachments).toEqual([]);
    expect(p.files.map((f) => f.name)).toEqual(["r.pdf"]);
    expect(p.to).toBe("a@x.co.id;b@x.co.id"); expect(p.cc).toBe("c@x.co.id"); expect(p.subject).toBe("S"); expect(p.version).toBe(2);
  });
  it("sender fields are empty unless a sender is supplied", () => {
    expect(buildSupplierEmailPayload({ ...base, to: ["a@x.co.id"], cc: [] }).from).toBe("");
    const p = buildSupplierEmailPayload({ ...base, to: ["a@x.co.id"], cc: [], sender: { name: "Budi", email: "budi@x.co.id" } });
    expect(p.from).toBe("budi@x.co.id"); expect(p.senderName).toBe("Budi");
  });
  it("refuses to build without a valid recipient, subject or message", () => {
    expect(() => buildSupplierEmailPayload({ ...base, to: ["nope"], cc: [] })).toThrow(/recipient/);
    expect(() => buildSupplierEmailPayload({ ...base, subject: " ", to: ["a@x.co.id"], cc: [] })).toThrow(/Subject/);
  });
  it("refuses oversized attachments instead of letting the flow fail", () => {
    const big = "A".repeat(Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 8);
    expect(() => buildSupplierEmailPayload({ ...base, to: ["a@x.co.id"], cc: [], attachments: [{ name: "x.pdf", contentType: "application/pdf", contentBytes: big }] })).toThrow(/10 MB/);
  });
  it("every key the website sends is declared in the schema the flow uses", () => {
    const p = buildSupplierEmailPayload({ ...base, to: ["a@x.co.id"], cc: [] });
    for (const k of Object.keys(p)) expect(Object.keys(SUPPLIER_EMAIL_SCHEMA.properties)).toContain(k);
  });
  it("the schema embedded in docs/POWER_AUTOMATE_ALL_FLOWS.md equals the code (no drift)", () => {
    const doc = readFileSync("docs/POWER_AUTOMATE_ALL_FLOWS.md", "utf8");
    const block = doc.split("<!-- SUPPLIER_EMAIL_SCHEMA -->")[1].match(/```json\n([\s\S]*?)\n```/)![1];
    expect(JSON.parse(block)).toEqual(JSON.parse(JSON.stringify(SUPPLIER_EMAIL_SCHEMA)));
  });
});

describe("duplicate-send guard", () => {
  const now = new Date("2026-11-07T12:00:00Z");
  it("blocks a second send inside the gap, allows after it, never blocks when disabled or never sent", () => {
    expect(recentlySent("2026-11-07T08:00:00Z", now, 24)).toBe(true);
    expect(recentlySent("2026-11-05T08:00:00Z", now, 24)).toBe(false);
    expect(recentlySent("2026-11-07T11:59:00Z", now, 0)).toBe(false);
    expect(recentlySent(null, now, 24)).toBe(false);
  });
  it("env parsing falls back to 24h", () => { expect(gapHoursFromEnv(undefined)).toBe(24); expect(gapHoursFromEnv("6")).toBe(6); expect(gapHoursFromEnv("x")).toBe(24); });
});

import { toHtml } from "@/lib/followup/payload";
describe("HTML body for Outlook", () => {
  it("escapes markup and keeps line breaks", () => {
    expect(toHtml("Dear <ACME> & team,\nPart A\r\nPart B")).toBe('<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt">Dear &lt;ACME&gt; &amp; team,<br>Part A<br>Part B</div>');
  });
});
