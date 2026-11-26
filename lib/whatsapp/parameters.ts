export type WhatsAppContactTokens = {
  contact_name?: string | null;
  supplier_name?: string | null;
  supplier_code?: string | null;
  whatsapp_phone_e164?: string | null;
};

export function renderWhatsAppTemplateParameters(
  templates: string[],
  contact: WhatsAppContactTokens,
): string[] {
  const values: Record<string, string> = {
    contact_name: String(contact.contact_name || "there"),
    supplier_name: String(contact.supplier_name || ""),
    supplier_code: String(contact.supplier_code || ""),
    phone: String(contact.whatsapp_phone_e164 || ""),
  };
  return templates.map((template) => template.replace(/\{\{\s*(contact_name|supplier_name|supplier_code|phone)\s*\}\}/gi, (match, key: string) => {
    const value = values[key.toLowerCase()];
    return value === undefined ? match : value;
  }));
}
