import { describe, expect, it, vi } from "vitest";
import { buildExcelPayload, flowConfig, postToFlow, renderFollowup } from "@/lib/automation/flow";

describe("power automate bridge", () => {
  it("only accepts https flow URLs", () => {
    expect(flowConfig({ POWER_AUTOMATE_EXCEL_URL: "http://x", POWER_AUTOMATE_EMAIL_URL: "https://prod.logic.azure.com/a?sig=1", POWER_AUTOMATE_SECRET: " s " })).toEqual({ excelUrl: null, emailUrl: "https://prod.logic.azure.com/a?sig=1", secret: "s", mail: null });
    expect(flowConfig({}).excelUrl).toBeNull();
  });
  it("maps AO–AW to workbook headers keyed by code", () => {
    const p = buildExcelPayload({ source_record_key: "K1", judge: "OK", km_judge: null, assigned_person: "Luthfi" });
    expect(p.code).toBe("K1"); expect(p["Judge OK/NG"]).toBe("OK"); expect(p["KM Judge"]).toBe(""); expect(p["Assigned person"]).toBe("Luthfi");
  });
  it("renders a follow-up with part number and supplier", () => {
    const m = renderFollowup({ errorType: "Mass tolerance range", supplierName: "ACME", supplierCode: "S1", partNo: "P-1" });
    expect(m.subject).toContain("P-1"); expect(m.body).toContain("Dear ACME team,"); expect(m.body).toContain("P-1");
  });
  it("treats only 2xx as delivered and sends the secret as a header", async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response("", { status: 202 })).mockResolvedValueOnce(new Response("", { status: 500 })).mockRejectedValueOnce(new Error("boom"));
    expect((await postToFlow("https://x", "sec", { a: 1 }, f as unknown as typeof fetch)).ok).toBe(true);
    expect((f.mock.calls[0][1] as RequestInit).headers).toMatchObject({ "x-imds-secret": "sec" });
    expect(await postToFlow("https://x", null, {}, f as unknown as typeof fetch)).toMatchObject({ ok: false, status: 500 });
    expect(await postToFlow("https://x", null, {}, f as unknown as typeof fetch)).toMatchObject({ ok: false, status: 0 });
  });
});

import { mailSubject, transportFor } from "@/lib/automation/flow";
describe("mail transport (no premium licence)", () => {
  const env = { FLOW_SMTP_HOST: "smtp.gmail.com", FLOW_SMTP_USER: "a@gmail.com", FLOW_SMTP_PASS: "pw", FLOW_INBOX_ADDRESS: "me@corp.com", POWER_AUTOMATE_SECRET: "s3" };
  it("falls back to mail only when SMTP, inbox and secret are all set", () => {
    expect(transportFor("EXCEL_UPSERT", flowConfig(env))).toBe("mail");
    expect(transportFor("EXCEL_UPSERT", flowConfig({ ...env, POWER_AUTOMATE_SECRET: "" }))).toBeNull();
    expect(transportFor("SUPPLIER_EMAIL", flowConfig({ ...env, POWER_AUTOMATE_EMAIL_URL: "https://x.logic.azure.com/a" }))).toBe("http");
    expect(flowConfig(env).mail?.port).toBe(465);
  });
  it("puts the secret in the subject the flow filters on", () => { expect(mailSubject("s3", "excel_upsert")).toBe("IMDS-SYNC|s3|excel_upsert"); });
});

import { buildTestPayload, toCsv, EXCEL_HEADERS } from "@/lib/automation/flow";
describe("test payload and CSV seed", () => {
  it("uses the fixed IMDS-PING row", () => { const p = buildTestPayload(new Date("2026-11-07T10:00:00Z")); expect(p.code).toBe("IMDS-PING"); expect(p["Assigned person"]).toContain("2026-11-07 10:00:00"); });
  it("exports headers in the Excel table order and neutralises formulas", () => {
    const csv = toCsv([{ ...buildExcelPayload({ source_record_key: "K1", judge: "OK", ok_comment: "=HYPERLINK(\"x\")", km_comment: "a,b" }) }]);
    expect(csv.replace("﻿", "").split("\r\n")[0]).toBe(EXCEL_HEADERS.join(","));
    expect(csv).toContain("'=HYPERLINK"); expect(csv).toContain('"a,b"');
  });
});
