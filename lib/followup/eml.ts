/**
 * An unsent e-mail (.eml with "X-Unsent: 1"). Opening it in Outlook for Windows/Mac shows an
 * editable draft in the user's OWN mailbox, with the attachments already in place. No Power
 * Automate, no Microsoft Graph, works for every colleague: the user presses Send in Outlook.
 */
export type EmlAttachment = { name: string; contentType: string; contentBytes: string };
export type EmlInput = { to: string[]; cc: string[]; subject: string; body: string; attachments?: EmlAttachment[]; date?: Date; html?: string };

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const wrap = (s: string) => s.replace(/.{1,76}/g, "$&\r\n").trimEnd();
/** RFC 2047 encoded-word for non-ASCII headers. */
export function encodeHeader(value: string): string {
  const clean = value.replace(/[\r\n]+/g, " ");
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${b64(clean)}?=`;
}
const safeName = (n: string) => n.replace(/[\r\n"\\]+/g, "_").slice(0, 120) || "attachment";
const addresses = (list: string[]) => list.map((a) => a.replace(/[\r\n,;<>]+/g, "").trim()).filter(Boolean).join(", ");

export function buildEml(input: EmlInput): string {
  const boundary = "imds-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const head = [
    "X-Unsent: 1",
    `To: ${addresses(input.to)}`,
    ...(input.cc.length ? [`Cc: ${addresses(input.cc)}`] : []),
    `Subject: ${encodeHeader(input.subject)}`,
    `Date: ${(input.date || new Date()).toUTCString()}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`
  ];
  const plain = ["Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", wrap(b64(input.body.replace(/\r?\n/g, "\r\n")))].join("\r\n");
  // With HTML (font and layout from Settings) the body is multipart/alternative; Outlook shows the HTML, the text stays as fallback.
  const alt = boundary + "-alt";
  const bodyPart = input.html
    ? [`Content-Type: multipart/alternative; boundary="${alt}"`, "", `--${alt}`, plain, `--${alt}`,
       "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", wrap(b64(input.html)), `--${alt}--`].join("\r\n")
    : plain;
  const parts = [`--${boundary}\r\n${bodyPart}`];
  for (const a of input.attachments || []) {
    const name = safeName(a.name);
    parts.push([
      `--${boundary}`, `Content-Type: ${a.contentType.replace(/[\r\n]+/g, "")}; name="${encodeHeader(name)}"`,
      `Content-Disposition: attachment; filename="${encodeHeader(name)}"`, "Content-Transfer-Encoding: base64", "",
      wrap(a.contentBytes.replace(/\s+/g, ""))
    ].join("\r\n"));
  }
  return head.join("\r\n") + "\r\n\r\n" + parts.join("\r\n") + `\r\n--${boundary}--\r\n`;
}

export function emlFileName(supplier: string, date = new Date()): string {
  return `IMDS_${supplier.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 60) || "email"}_${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(date)}.eml`;
}
