// Pure validation helpers for access requests (unit-tested).
export const SUPPLIER_CODE = /^[A-Z0-9_-]{1,20}$/;
export const TMMIN_ROLES = ["admin", "preparer", "reviewer", "viewer", "rule_author", "rule_approver"] as const;

export function normalizeEmail(v: unknown) { return String(v ?? "").trim().toLowerCase(); }
export function validEmail(v: string) { return v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); }
export function cleanText(v: unknown, max: number) { return String(v ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max); }
export function normalizeSupplierCode(v: unknown) { return String(v ?? "").trim().toUpperCase(); }

export function allowedStaffDomain(email: string, domains: string | undefined) {
  const list = (domains || "").split(",").map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
  if (!list.length) return true; // not configured: admin reviews every request anyway
  return list.includes(email.split("@")[1] || "");
}

export type SupplierInput = { name: string; company: string; email: string; supplierCode: string };
export function validateSupplierRequest(body: Record<string, unknown>): { ok: true; value: SupplierInput } | { ok: false; error: string } {
  const name = cleanText(body.name, 80), company = cleanText(body.company, 120), email = normalizeEmail(body.email), supplierCode = normalizeSupplierCode(body.supplierCode);
  if (name.length < 2) return { ok: false, error: "Enter your full name." };
  if (company.length < 2) return { ok: false, error: "Enter your company." };
  if (!validEmail(email)) return { ok: false, error: "Enter a valid work email." };
  if (!SUPPLIER_CODE.test(supplierCode)) return { ok: false, error: "Enter your supplier code (letters, digits, - and _)." };
  return { ok: true, value: { name, company, email, supplierCode } };
}

/** Which roles an admin may grant for a request kind. Suppliers can only ever become `supplier`. */
export function grantableRoles(kind: string): readonly string[] {
  return kind === "supplier" ? ["supplier"] : kind === "tmmin" ? TMMIN_ROLES : [];
}

/** Escape LIKE wildcards so an e-mail with _ or % matches literally in .ilike(). */
export function escapeLike(v: string) { return v.replace(/[\\%_]/g, (c) => "\\" + c); }
