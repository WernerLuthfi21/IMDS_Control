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

export function validatePassword(pw: unknown, confirm?: unknown): string | null {
  const v = typeof pw === "string" ? pw : "";
  if (v.length < 10) return "Use at least 10 characters.";
  if (v.length > 72) return "Use at most 72 characters.";
  if (!/[A-Za-z]/.test(v) || !/\d/.test(v)) return "Include letters and at least one digit.";
  if (confirm !== undefined && v !== confirm) return "Passwords do not match.";
  return null;
}

export type SupplierInput = { name: string; company: string; email: string; supplierCode: string; password: string };
export function validateSupplierRequest(body: Record<string, unknown>): { ok: true; value: SupplierInput } | { ok: false; error: string } {
  const name = cleanText(body.name, 80), company = cleanText(body.company, 120), email = normalizeEmail(body.email), supplierCode = normalizeSupplierCode(body.supplierCode);
  if (name.length < 2) return { ok: false, error: "Enter your full name." };
  if (company.length < 2) return { ok: false, error: "Enter your company." };
  if (!validEmail(email)) return { ok: false, error: "Enter a valid work email." };
  if (!SUPPLIER_CODE.test(supplierCode)) return { ok: false, error: "Enter your supplier code (letters, digits, - and _)." };
  const pwError = validatePassword(body.password, body.password2);
  if (pwError) return { ok: false, error: pwError };
  return { ok: true, value: { name, company, email, supplierCode, password: String(body.password) } };
}

/** Which roles an admin may grant for a request kind. Suppliers can only ever become `supplier`. */
export function grantableRoles(kind: string): readonly string[] {
  return kind === "supplier" ? ["supplier"] : kind === "tmmin" ? TMMIN_ROLES : [];
}

/** Escape LIKE wildcards so an e-mail with _ or % matches literally in .ilike(). */
export function escapeLike(v: string) { return v.replace(/[\\%_]/g, (c) => "\\" + c); }
