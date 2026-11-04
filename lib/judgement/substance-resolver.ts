import { isValidCas, lookupSubstance, normalizeCas } from "@/lib/reference-data";

type SourceRow = { sourceRow?: number; values?: unknown[]; casOriginal?: string; substanceName?: string; name?: string; classification?: string; class?: string; reason?: string; gadslNo?: string | number };

export type SubstanceFlow = {
  casRaw: string; casNormalized: string | null;
  status: "INVALID_CAS" | "NO_REFERENCE_MATCH" | "FLOW_IDENTIFIED" | "FLOW_REQUIRES_DESTINATION" | "FLOW_UNMAPPED";
  gadsl: Array<{ sourceRow: number | null; name: string; cas: string; classification: string; reason: string }>;
  tszGroups: Array<{ tszNo: string; name: string; flow: string; sourceRow: number | null }>;
  appendices: Array<{ appendix: "4" | "5" | "6"; tszNo: string; item: string; sourceRow: number | null }>;
  familyFlows: string[]; destinationCode: string | null; materialUse: string | null;
  remainingRequirements: string[]; trace: string[];
};

const asRow = (value: unknown) => value as SourceRow;
const cell = (row: SourceRow, index: number) => String(row.values?.[index] ?? "").replace(/\u00a0/g, " ").trim();
const familyOf = (flow: string) => {
  const f = flow.toLowerCase();
  if (f.includes("pops")) return "POPs";
  if (f.includes("annex xvii")) return "REACH Annex XVII";
  if (f.includes("annex xiv") || f.includes("annex xiiv")) return "REACH Annex XIV";
  if (f.includes("elv")) return "ELV";
  if (f.includes("refer to tsz") || f.includes("see tsz")) return "TSZ0001G dedicated table";
  return flow || "Unmapped";
};

export { normalizeCas };
export function resolveSubstance(casRaw: string, destinationCode?: string, materialUse?: string): SubstanceFlow {
  const normalized = normalizeCas(casRaw || "");
  const valid = Boolean(normalized) && isValidCas(normalized);
  const lookup = valid ? lookupSubstance(normalized) : null;
  const gadslRows = (lookup?.gadsl ?? []).map(asRow);
  const tszRows = (lookup?.tszGroups ?? []).map(asRow);
  const appendices = [
    ...(lookup?.pops ?? []).map((row: unknown) => ({ appendix: "4" as const, row: asRow(row) })),
    ...(lookup?.reachAnnexXVII ?? []).map((row: unknown) => ({ appendix: "5" as const, row: asRow(row) })),
    ...(lookup?.reachAnnexXIV ?? []).map((row: unknown) => ({ appendix: "6" as const, row: asRow(row) }))
  ];
  const groups = tszRows.map(row => ({
    tszNo: cell(row, 1), name: cell(row, 2), flow: cell(row, 4), sourceRow: row.sourceRow ?? null
  }));
  const flows = [...new Set(groups.map(row => familyOf(row.flow)))];
  const dest = String(destinationCode ?? "").trim();
  const use = String(materialUse ?? "").trim();
  const noMatch = Boolean(lookup?.notFound);
  const unmapped = groups.some(row => row.flow.toLowerCase().includes("refer to tsz") || row.flow.toLowerCase().includes("see tsz") || !row.flow);
  const status: SubstanceFlow["status"] = !valid ? "INVALID_CAS" : noMatch ? "NO_REFERENCE_MATCH" : unmapped ? "FLOW_UNMAPPED" : !dest ? "FLOW_REQUIRES_DESTINATION" : "FLOW_IDENTIFIED";
  const remainingRequirements: string[] = [];
  if (!valid) remainingRequirements.push("Provide a valid CAS number from the source IMDS record");
  if (!dest) remainingRequirements.push("Select destination code from the approved G-CATS destination list");
  if (!use) remainingRequirements.push("Confirm material / component use only if it is not present in the source IMDS record");
  if (noMatch) remainingRequirements.push("Review CAS against GADSL and Appendix 3; retain evidence of the no-match");
  if (unmapped) remainingRequirements.push("Resolve the Appendix 3 TSZ0001G dedicated-table reference; do not infer membership");
  const gadsl = gadslRows.map(row => ({
    sourceRow: row.sourceRow ?? null,
    name: String(row.substanceName ?? row.name ?? row.values?.[2] ?? ""),
    cas: String(row.casOriginal ?? normalized),
    classification: String(row.classification ?? row.class ?? row.values?.[4] ?? ""),
    reason: String(row.reason ?? row.values?.[5] ?? "")
  }));
  const appendixRows = appendices.map(({ appendix, row }) => ({
    appendix, tszNo: cell(row, 1), item: appendix === "4" ? cell(row, 3) : appendix === "5" ? cell(row, 5) : cell(row, 2), sourceRow: row.sourceRow ?? null
  }));
  const trace = [
    `CAS validation: ${valid ? "VALID" : "INVALID / MISSING"}`,
    `GADSL 2026 V1 exact CAS matches: ${gadsl.length}`,
    `Appendix 3 TSZ group matches: ${groups.map(x => x.tszNo).filter(Boolean).join(", ") || "none"}`,
    `Appendix 4–6 rows matched: ${appendixRows.length}`,
    ...flows.map(flow => `Family flow: ${flow}`)
  ];
  return {
    casRaw, casNormalized: valid ? normalized : null, status, gadsl, tszGroups: groups,
    appendices: appendixRows, familyFlows: flows, destinationCode: dest || null,
    materialUse: use || null, remainingRequirements, trace
  };
}
