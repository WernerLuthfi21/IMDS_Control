import { graphApiVersion, type WhatsAppSenderConfig } from "./config";

export type ApprovedTemplate = {
  name: string;
  language: string;
  category?: string;
  status: string;
};

type GraphError = { message?: string; code?: number; error_subcode?: number };
type GraphResponse = {
  data?: Array<{ name?: string; language?: string; status?: string; category?: string }>;
  messages?: Array<{ id?: string; message_status?: string }>;
  error?: GraphError;
};

function graphError(payload: GraphResponse, fallback: string): string {
  const message = payload.error?.message?.trim();
  const code = payload.error?.code;
  return (message || fallback) + (code ? " (Meta error " + code + ")" : "");
}

export async function fetchApprovedTemplates(
  sender: WhatsAppSenderConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<ApprovedTemplate[]> {
  const url = new URL("https://graph.facebook.com/" + graphApiVersion() + "/" + sender.wabaId + "/message_templates");
  url.searchParams.set("fields", "name,language,status,category");
  url.searchParams.set("limit", "100");
  const response = await fetchImpl(url, {
    headers: { Authorization: "Bearer " + sender.accessToken },
    signal: AbortSignal.timeout(20000),
  });
  const payload = await response.json().catch(() => ({})) as GraphResponse;
  if (!response.ok) throw new Error(graphError(payload, "Could not load WhatsApp templates."));
  return (payload.data || [])
    .filter((item) => item.name && item.language && item.status === "APPROVED")
    .map((item) => ({
      name: String(item.name),
      language: String(item.language),
      category: item.category,
      status: String(item.status),
    }));
}

export async function sendWhatsAppTemplate(
  sender: WhatsAppSenderConfig,
  input: { to: string; templateName: string; language: string; parameters: string[] },
  fetchImpl: typeof fetch = fetch,
): Promise<{ messageId: string }> {
  const components = input.parameters.length
    ? [{
        type: "body",
        parameters: input.parameters.map((text) => ({ type: "text", text })),
      }]
    : undefined;
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: input.to.replace(/\D/g, ""),
    type: "template",
    template: {
      name: input.templateName,
      language: { code: input.language },
      ...(components ? { components } : {}),
    },
  };
  const response = await fetchImpl(
    "https://graph.facebook.com/" + graphApiVersion() + "/" + sender.phoneNumberId + "/messages",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + sender.accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    },
  );
  const result = await response.json().catch(() => ({})) as GraphResponse;
  if (!response.ok) throw new Error(graphError(result, "WhatsApp Cloud API rejected the message."));
  const messageId = result.messages?.[0]?.id;
  if (!messageId) throw new Error("Meta accepted no message ID in its response.");
  return { messageId };
}
