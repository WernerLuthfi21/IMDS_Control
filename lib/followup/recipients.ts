// One place that decides WHO a supplier e-mail goes to. Used by the Tracker follow-up and the Judgement follow-up so the
// two can never disagree about a supplier's PIC / CC again. Pure: no I/O.

export type ContactRow = { supplier_code?: string | null; email?: string | null; contact_role?: string | null; active?: boolean | null };
export type Role = "PIC" | "CC" | "SPV" | "OTHER";

const EMAIL = /^[^@\s;,]+@[^@\s;,]+\.[^@\s;,]+$/;
export function emailsOf(value: unknown): string[] {
  return [...new Set(String(value ?? "").split(/[;,\s]+/).map((s) => s.trim().toLowerCase()).filter((s) => EMAIL.test(s)))];
}

/** "PIC", "PIC 1", "Main PIC" -> PIC · "SPV", "Marketing SPV" -> SPV · "CC", "Marketing Staff" -> CC · blank/other -> OTHER */
export function roleOf(raw: unknown): Role {
  const r = String(raw ?? "").toUpperCase();
  if (r.includes("SPV")) return "SPV";                    // "PIC SPV" is a supervisor, never the primary recipient
  if (r.includes("PIC")) return "PIC";
  if (r.includes("CC") || r.includes("MARKETING")) return "CC";
  return "OTHER";
}

export type RecipientOptions = {
  supplierCode: string;
  contacts: ContactRow[];
  /** MAIN PIC EMAIL cells of the supplier's rows in the Part List. Authoritative when present. */
  mainPicEmails?: string[];
  /** Which directory roles are copied. Default = what the Tracker already did (CC + marketing + SPV). */
  ccRoles?: Role[];
  /** Addresses typed by the sender in the UI. */
  extraCc?: string[];
};
export type Recipients = { to: string[]; cc: string[]; source: "part_list" | "directory_pic" | "directory_other" | "none"; warnings: string[] };

export function resolveRecipients(o: RecipientOptions): Recipients {
  const code = o.supplierCode.trim().toUpperCase();
  const mine = o.contacts.filter((c) => c.active !== false && String(c.supplier_code ?? "").trim().toUpperCase() === code);
  const byRole = (role: Role) => mine.filter((c) => roleOf(c.contact_role) === role).flatMap((c) => emailsOf(c.email));
  const warnings: string[] = [];

  let to: string[] = [], source: Recipients["source"] = "none";
  const main = (o.mainPicEmails ?? []).flatMap(emailsOf);
  if (main.length) { to = [...new Set(main)]; source = "part_list"; }
  else if (byRole("PIC").length) { to = [...new Set(byRole("PIC"))]; source = "directory_pic"; }
  else if (byRole("OTHER").length) {          // legacy rows with no role: still reachable, but flagged
    to = [...new Set(byRole("OTHER"))]; source = "directory_other";
    warnings.push("Recipient comes from a directory contact with no role. Mark it PIC in the supplier directory.");
  } else warnings.push("No PIC e-mail found in the Part List or the supplier directory.");

  const roles = o.ccRoles ?? ["CC", "SPV"];
  const cc = [...new Set([...roles.flatMap(byRole), ...(o.extraCc ?? []).flatMap(emailsOf)])].filter((e) => !to.includes(e));
  return { to, cc, source, warnings };
}
