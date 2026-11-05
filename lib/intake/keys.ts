/** Matching key for a delivery part number: case, spaces and hyphens are ignored; nothing else is merged. */
export function partKey(value: string | null | undefined): string {
  return String(value ?? "").toUpperCase().replace(/[\s\-_/.]/g, "");
}
export function supplierKey(value: string | null | undefined): string {
  return String(value ?? "").toUpperCase().replace(/\s+/g, "");
}
export const CAS_IN_TEXT = /(?<![\d-])\d{2,7}-\d{2}-\d(?![\d-])/g;
