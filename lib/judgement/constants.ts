/** Small constants shared by server rules and browser UI (no reference data imported here). */
export const DESTINATION_OPTIONS: Array<[string, string]> = [["EU", "EU"], ["KR", "KR"], ["CN", "CN"], ["TW", "TW"], ["IN", "IN"], ["JP", "JP"], ["OTH", "Other"]];
/** Questions only Toyota can answer (vehicle destination, vehicle-specific use). Everything else is a supplier-knowledge question. */
export const TOYOTA_OWNED = new Set(["destination", "usCarpet", "nonEuReq"]);
