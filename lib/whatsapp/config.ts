export type WhatsAppSenderConfig = {
  key: string;
  label: string;
  displayPhoneNumber: string;
  phoneNumberId: string;
  wabaId: string;
  accessToken: string;
};

export type PublicWhatsAppSender = Pick<WhatsAppSenderConfig, "key" | "label" | "displayPhoneNumber">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Sender credentials are configured only as server-side environment variables.
 * Tokens are never stored in Postgres or returned to the browser.
 *
 * WHATSAPP_SENDERS_JSON=[
 *   {"key":"ops-a","label":"Operations A","displayPhoneNumber":"+62...","phoneNumberId":"...","wabaId":"...","accessToken":"..."}
 * ]
 */
export function getWhatsAppSenders(raw = process.env.WHATSAPP_SENDERS_JSON): WhatsAppSenderConfig[] {
  if (!raw?.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("WHATSAPP_SENDERS_JSON is not valid JSON.");
  }
  if (!Array.isArray(parsed)) throw new Error("WHATSAPP_SENDERS_JSON must be a JSON array.");
  const senders: WhatsAppSenderConfig[] = [];
  for (const item of parsed) {
    if (!isRecord(item)) continue;
    const sender = {
      key: String(item.key ?? "").trim(),
      label: String(item.label ?? "").trim(),
      displayPhoneNumber: String(item.displayPhoneNumber ?? "").trim(),
      phoneNumberId: String(item.phoneNumberId ?? "").trim(),
      wabaId: String(item.wabaId ?? "").trim(),
      accessToken: String(item.accessToken ?? "").trim(),
    };
    if (!/^[a-z0-9][a-z0-9_-]{1,39}$/i.test(sender.key)) continue;
    if (!sender.label || !sender.phoneNumberId || !sender.wabaId || !sender.accessToken) continue;
    if (!/^[0-9]+$/.test(sender.phoneNumberId) || !/^[0-9]+$/.test(sender.wabaId)) continue;
    if (senders.some((existing) => existing.key === sender.key)) {
      throw new Error("Duplicate WhatsApp sender key: " + sender.key);
    }
    senders.push(sender);
  }
  return senders;
}

export function getWhatsAppSender(key: string): WhatsAppSenderConfig | null {
  return getWhatsAppSenders().find((sender) => sender.key === key) ?? null;
}

export function publicWhatsAppSenders(): PublicWhatsAppSender[] {
  return getWhatsAppSenders().map(({ key, label, displayPhoneNumber }) => ({ key, label, displayPhoneNumber }));
}

export function graphApiVersion(): string {
  const value = process.env.WHATSAPP_GRAPH_API_VERSION?.trim() || "v27.0";
  if (!/^v\d+\.\d+$/.test(value)) throw new Error("WHATSAPP_GRAPH_API_VERSION must look like v27.0.");
  return value;
}
