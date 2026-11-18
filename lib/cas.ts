/**
 * CAS number helpers with no data attached. Kept apart from lib/reference-data.ts so browser code
 * (supplier self-check, intake column detection) can validate a CAS without shipping the 3 MB GADSL list.
 */
export function normalizeCas(value: string) {
  return value.trim().replace(/[\s‐‑‒–—]/g, "-").replace(/[^0-9-]/g, "");
}

/** CAS check digit: weighted sum of the digits (right to left, weights 1, 2, 3…) modulo 10. */
export function isValidCas(value: string) {
  const cas = normalizeCas(value);
  if (!/^\d{2,7}-\d{2}-\d$/.test(cas)) return false;
  const digits = cas.replace(/-/g, "").slice(0, -1).split("").reverse();
  const sum = digits.reduce((acc, digit, index) => acc + Number(digit) * (index + 1), 0);
  return sum % 10 === Number(cas.split("-").at(-1));
}
