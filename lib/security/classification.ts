export type DocumentClassification = "PROTECTED" | "INTERNAL" | "PUBLIC" | "CONFIDENTIAL" | "UNKNOWN";

export function canProcessClassification(value: unknown): value is "PROTECTED" | "INTERNAL" | "PUBLIC" {
  return value === "PROTECTED" || value === "INTERNAL" || value === "PUBLIC";
}

export function classificationBlockReason(value: unknown) {
  if (value === "CONFIDENTIAL") return "CONFIDENTIAL content is prohibited from this project workflow and must not be processed.";
  if (value === "UNKNOWN" || value === undefined || value === null || value === "") return "Document classification is unknown. Confirm it before processing.";
  return "Unsupported document classification.";
}
