/** Small constants shared by server rules and browser UI (no reference data imported here). */
export const DESTINATION_OPTIONS: Array<[string, string]> = [["EU", "EU"], ["KR", "KR"], ["CN", "CN"], ["TW", "TW"], ["IN", "IN"], ["JP", "JP"], ["OTH", "Other"]];
/** Questions only Toyota can answer (vehicle destination, vehicle-specific use). Everything else is a supplier-knowledge question. */
export const TOYOTA_OWNED = new Set(["destination", "usCarpet", "nonEuReq", "naDest"]);
/** Questions the reviewer answers from the appendix, TSZ0001G or the IMDS data (not the supplier, not the vehicle). */
export const REVIEWER_CHECK = new Set(["appendixLegal", "sunset3m", "pfoaTotal", "airCon", "refrigerant", "purPvc", "perchlorateUse", "benzidine",
  "app20", "app46", "matlClass", "lacquer", "aluminium", "methanolCase1", "wwf", "total", "thr", "textileSkin"]);
