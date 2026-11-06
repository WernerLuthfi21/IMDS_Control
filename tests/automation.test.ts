import { describe, expect, it, vi } from "vitest";
import { buildExcelPayload, flowConfig, postToFlow, renderFollowup } from "@/lib/automation/flow";

describe("power automate bridge", () => {
  it("only accepts https flow URLs", () => {
    expect(flowConfig({ POWER_AUTOMATE_EXCEL_URL: "http://x", POWER_AUTOMATE_EMAIL_URL: "https://prod.logic.azure.com/a?sig=1", POWER_AUTOMATE_SECRET: " s " })).toEqual({ excelUrl: null, emailUrl: "https://prod.logic.azure.com/a?sig=1", secret: "s" });
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
