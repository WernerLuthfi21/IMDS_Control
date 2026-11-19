/**
 * Excel error values (#N/A, #REF!, …) must never reach a supplier e-mail, PDF or Excel. They used to be
 * stored as the JSON text {"error":"#N/A"} by the importers; this turns them (and bare error codes) into "".
 */
const ERROR_CODE = /^#(?:N\/A|REF!|VALUE!|DIV\/0!|NAME\?|NULL!|NUM!|SPILL!|CALC!|GETTING_DATA)$/i;
export function cleanCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("error" in o) return "";
    if ("result" in o) return cleanCell(o.result);
    return "";
  }
  const s = String(v).trim();
  if (!s) return "";
  if (ERROR_CODE.test(s)) return "";
  if (/^\{\s*"error"\s*:/.test(s)) return "";
  return s;
}
