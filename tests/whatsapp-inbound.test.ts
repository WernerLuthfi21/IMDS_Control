import { describe, expect, it } from "vitest";
import { isWhatsAppOptOutText, normalizeWhatsAppE164 } from "@/lib/whatsapp/inbound";

describe("WhatsApp inbound opt-out", () => {
  it("normalizes an incoming sender to E.164 digits with plus", () => {
    expect(normalizeWhatsAppE164("628123456789")).toBe("+628123456789");
  });
  it("recognizes the supported opt-out keywords without treating ordinary messages as opt-out", () => {
    expect(isWhatsAppOptOutText("STOP")).toBe(true);
    expect(isWhatsAppOptOutText(" berhenti ")).toBe(true);
    expect(isWhatsAppOptOutText("Please call me")).toBe(false);
  });
});
