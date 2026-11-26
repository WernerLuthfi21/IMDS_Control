import { afterEach, describe, expect, it, vi } from "vitest";
import { getWhatsAppSenders, publicWhatsAppSenders } from "@/lib/whatsapp/config";
import { sendWhatsAppTemplate } from "@/lib/whatsapp/cloud-api";
import { renderWhatsAppTemplateParameters } from "@/lib/whatsapp/parameters";

afterEach(() => vi.unstubAllEnvs());

describe("WhatsApp sender configuration", () => {
  const senders = [{
    key: "imds-main",
    label: "IMDS Main",
    displayPhoneNumber: "+62 812-0000-0000",
    phoneNumberId: "123456789",
    wabaId: "987654321",
    accessToken: "server-secret-token",
  }];

  it("parses configured senders and keeps the access token out of the public list", () => {
    vi.stubEnv("WHATSAPP_SENDERS_JSON", JSON.stringify(senders));
    expect(getWhatsAppSenders()).toHaveLength(1);
    expect(publicWhatsAppSenders()).toEqual([{
      key: "imds-main",
      label: "IMDS Main",
      displayPhoneNumber: "+62 812-0000-0000",
    }]);
    expect(JSON.stringify(publicWhatsAppSenders())).not.toContain("server-secret-token");
  });

  it("rejects malformed JSON and duplicate sender keys", () => {
    expect(() => getWhatsAppSenders("{")).toThrow("not valid JSON");
    expect(() => getWhatsAppSenders(JSON.stringify([senders[0], senders[0]]))).toThrow("Duplicate");
  });
});

describe("WhatsApp template parameters", () => {
  it("renders supplier tokens into positional template parameters", () => {
    expect(renderWhatsAppTemplateParameters(
      ["Hello {{contact_name}}", "{{supplier_name}} / {{supplier_code}}", "{{phone}}"],
      { contact_name: "Budi", supplier_name: "PT Example", supplier_code: "S-10", whatsapp_phone_e164: "+628123456789" },
    )).toEqual([
      "Hello Budi",
      "PT Example / S-10",
      "+628123456789",
    ]);
  });
});

describe("WhatsApp Cloud API transport", () => {
  it("posts a template to the selected sender phone number ID", async () => {
    vi.stubEnv("WHATSAPP_GRAPH_API_VERSION", "v27.0");
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ messages: [{ id: "wamid.test-1" }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    const result = await sendWhatsAppTemplate({
      key: "imds-main", label: "IMDS Main", displayPhoneNumber: "+628120000000",
      phoneNumberId: "123456789", wabaId: "987654321", accessToken: "secret",
    }, {
      to: "+628123456789", templateName: "supplier_update", language: "id",
      parameters: ["Budi", "S-10"],
    }, fetchMock as unknown as typeof fetch);

    expect(result.messageId).toBe("wamid.test-1");
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v27.0/123456789/messages");
    expect((options.headers as Record<string, string>).Authorization).toBe("Bearer secret");
    const payload = JSON.parse(String(options.body));
    expect(payload.to).toBe("628123456789");
    expect(payload.template.components[0].parameters).toEqual([
      { type: "text", text: "Budi" },
      { type: "text", text: "S-10" },
    ]);
  });
});
