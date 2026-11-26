export function normalizeWhatsAppE164(raw: string): string {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits ? "+" + digits : "";
}

export function isWhatsAppOptOutText(raw: string): boolean {
  return /^(stop|unsubscribe|berhenti|stop wa|hapus saya)$/i.test(String(raw || "").trim());
}
