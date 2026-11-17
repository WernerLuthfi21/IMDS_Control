import { describe, expect, it } from "vitest";
import { buildEml, emlFileName, encodeHeader } from "@/lib/followup/eml";

describe("Outlook draft (.eml)", () => {
  const eml = buildEml({ to: ["pic@sup.co.id"], cc: ["fuad-qc@toyota.co.id", "a@b.co"], subject: "IMDS Reminder – PT Alpha", body: "Dear Sir,\nPlease submit.", attachments: [{ name: "IMDS_5000.pdf", contentType: "application/pdf", contentBytes: Buffer.from("%PDF-1.4 test").toString("base64") }], date: new Date("2026-11-18T00:00:00Z") });
  it("opens as an unsent draft without a fixed sender", () => {
    expect(eml.startsWith("X-Unsent: 1\r\n")).toBe(true);
    expect(eml).not.toMatch(/^From:/m);
    expect(eml).toMatch(/^To: pic@sup\.co\.id$/m);
    expect(eml).toMatch(/^Cc: fuad-qc@toyota\.co\.id, a@b\.co$/m);
  });
  it("encodes a non-ASCII subject and keeps the body and attachment", () => {
    expect(eml).toMatch(/^Subject: =\?UTF-8\?B\?/m);
    const body = eml.split("Content-Transfer-Encoding: base64\r\n\r\n")[1].split("\r\n--")[0].replace(/\r\n/g, "");
    expect(Buffer.from(body, "base64").toString("utf8")).toBe("Dear Sir,\r\nPlease submit.");
    expect(eml).toContain('filename="IMDS_5000.pdf"');
    expect(eml.trimEnd().endsWith("--")).toBe(true);
  });
  it("cannot be header-injected", () => {
    const bad = buildEml({ to: ["x@y.z\r\nBcc: evil@x.y"], cc: [], subject: "Hi\r\nBcc: evil@x.y", body: "b" });
    expect(bad).not.toMatch(/^Bcc:/m);
    expect(encodeHeader("plain")).toBe("plain");
  });
  it("names the file after the supplier and date", () => {
    expect(emlFileName("PT. Alpha Metal (5000)", new Date("2026-11-18T00:00:00Z"))).toBe("IMDS_PT_Alpha_Metal_5000_2026-11-18.eml");
  });
});
