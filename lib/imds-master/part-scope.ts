/** Validate the selected master rows before creating a supplier-specific attachment. */
type Part = { company_name?: string | null; vendor_code?: string | null };
const norm = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ").toUpperCase();
export function verifyTrackerPartScope(o: { idsCount: number; parts: Part[]; supplierName: string; supplierCode: string; recap: boolean; requireParts: boolean }): string | null {
  if (o.idsCount !== o.parts.length) return "Some selected parts are missing or unavailable.";
  if (o.requireParts && !o.parts.length) return "Choose at least one current shared-master part.";
  if (o.recap) return null;
  for (const p of o.parts) {
    if (!norm(p.company_name) || norm(p.company_name) !== norm(o.supplierName)) return "Selected parts belong to a different supplier.";
    if (norm(p.vendor_code) && norm(o.supplierCode) && norm(p.vendor_code) !== norm(o.supplierCode)) return "Selected parts contain different vendor codes.";
  }
  return null;
}
