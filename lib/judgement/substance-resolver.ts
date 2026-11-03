import gadsl from "@/data/reference/gadsl-reference-2026-v1.json";
import appendix3 from "@/data/reference/appendix3-tsz-substance-groups.json";
import appendix4 from "@/data/reference/appendix4-pops.json";
import appendix5 from "@/data/reference/appendix5-reach-annex-xvii.json";
import appendix6 from "@/data/reference/appendix6-reach-annex-xiv.json";

type Sheet = { headers: string[]; records: Array<{ sourceRow: number; values: unknown[] }> };
type GadslHit = { sourceRow: number; name: string; cas: string; classification: string; reason: string };
export type SubstanceFlow = {
  casRaw: string; casNormalized: string | null; status: "INVALID_CAS" | "NO_REFERENCE_MATCH" | "FLOW_IDENTIFIED" | "FLOW_REQUIRES_DESTINATION" | "FLOW_UNMAPPED";
  gadsl: GadslHit[]; tszGroups: Array<{ tszNo: string; name: string; flow: string; sourceRow: number }>;
  appendices: Array<{ appendix: "4" | "5" | "6"; tszNo: string; item: string; sourceRow: number }>;
  familyFlows: string[]; destinationCode: string | null; materialUse: string | null;
  remainingRequirements: string[]; trace: string[];
};

const sheets = {
  gadsl: gadsl as unknown as Sheet,
  a3: appendix3 as unknown as Sheet,
  a4: appendix4 as unknown as Sheet,
  a5: appendix5 as unknown as Sheet,
  a6: appendix6 as unknown as Sheet
};
const text = (v: unknown) => String(v ?? "").replace(/\u00a0/g, " ").trim();
const headerIndex = (sheet: Sheet, test: (h: string) => boolean) => sheet.headers.findIndex(h => test(text(h).toLowerCase()));
const value = (sheet: Sheet, row: { values: unknown[] }, test: (h: string) => boolean) => {
  const i = headerIndex(sheet, test); return i < 0 ? "" : text(row.values[i]);
};
export function normalizeCas(raw: string): string | null {
  const match = text(raw).replace(/\s|_x000D_/gi, "").match(/^0*(\d{2,7})-?(\d{2})-?(\d)$/);
  if (!match) return null;
  const [, first, second, check] = match;
  const digits = (first + second).split("").reverse().map(Number);
  const sum = digits.reduce((total, digit, index) => total + digit * (index + 1), 0);
  return sum % 10 === Number(check) ? `${Number(first)}-${second}-${check}` : null;
}
function casList(raw: string): string[] {
  return raw.replace(/_x000D_/gi, "\n").split(/[\n;,]+/).map(normalizeCas).filter((x): x is string => Boolean(x));
}
function family(flow: string): string {
  const f = flow.toLowerCase();
  if (f.includes("pops")) return "POPs";
  if (f.includes("annex xvii")) return "REACH Annex XVII";
  if (f.includes("annex xiv") || f.includes("annex xiiv")) return "REACH Annex XIV";
  if (f.includes("elv")) return "ELV";
  if (f.includes("refer to tsz") || f.includes("see tsz")) return "TSZ0001G dedicated table";
  return flow || "Unmapped";
}
export function resolveSubstance(casRaw: string, destinationCode?: string, materialUse?: string): SubstanceFlow {
  const casNormalized = normalizeCas(casRaw);
  const result: SubstanceFlow = {
    casRaw, casNormalized, status: "INVALID_CAS", gadsl: [], tszGroups: [], appendices: [],
    familyFlows: [], destinationCode: text(destinationCode) || null, materialUse: text(materialUse) || null,
    remainingRequirements: [], trace: []
  };
  if (!casNormalized) {
    result.remainingRequirements.push("Provide a valid CAS number from the source IMDS record");
    result.trace.push("CAS format/checksum validation failed");
    return result;
  }
  const gadslSheet = sheets.gadsl;
  const gadslRows = gadslSheet.records.filter(row => casList(value(gadslSheet, row, h => h.includes("cas"))).includes(casNormalized));
  result.gadsl = gadslRows.map(row => ({
    sourceRow: row.sourceRow,
    name: value(gadslSheet, row, h => h.includes("substance") || h === "name"),
    cas: casNormalized,
    classification: value(gadslSheet, row, h => h.includes("class")),
    reason: value(gadslSheet, row, h => h.includes("reason"))
  }));
  result.trace.push(result.gadsl.length ? `GADSL 2026 V1: ${result.gadsl.length} exact CAS match(es)` : "GADSL 2026 V1: no exact CAS match");

  const a3 = sheets.a3;
  result.tszGroups = a3.records.filter(row => casList(value(a3, row, h => h.includes("cas"))).includes(casNormalized)).map(row => ({
    tszNo: value(a3, row, h => h.includes("tsz0001g")),
    name: value(a3, row, h => h.includes("substance name")),
    flow: value(a3, row, h => h.includes("judge flow")),
    sourceRow: row.sourceRow
  }));
  result.trace.push(result.tszGroups.length ? `Appendix 3: TSZ group(s) ${result.tszGroups.map(x => x.tszNo).join(", ")}` : "Appendix 3: no exact CAS group; 'various' and table references are not expanded");
  const groupIds = new Set(result.tszGroups.map(x => x.tszNo));
  const appendixSheets: Array<{ appendix: "4" | "5" | "6"; sheet: Sheet }> = [
    { appendix: "4", sheet: sheets.a4 }, { appendix: "5", sheet: sheets.a5 }, { appendix: "6", sheet: sheets.a6 }
  ];
  for (const entry of appendixSheets) {
    const groupIndex = headerIndex(entry.sheet, h => h.includes("tsz0001g"));
    if (groupIndex < 0) continue;
    for (const row of entry.sheet.records) {
      const id = text(row.values[groupIndex]);
      if (!groupIds.has(id)) continue;
      const item = value(entry.sheet, row, h => h.includes("item for judge") || h.includes("substance name") || h.includes("annexxiv"));
      result.appendices.push({ appendix: entry.appendix, tszNo: id, item, sourceRow: row.sourceRow });
    }
  }
  result.familyFlows = [...new Set(result.tszGroups.map(x => family(x.flow)))];
  if (!result.gadsl.length && !result.tszGroups.length) result.status = "NO_REFERENCE_MATCH";
  else if (!result.tszGroups.length) result.status = "FLOW_UNMAPPED";
  else if (result.familyFlows.some(x => x.includes("dedicated table") || x === "Unmapped")) result.status = "FLOW_UNMAPPED";
  else result.status = result.destinationCode ? "FLOW_IDENTIFIED" : "FLOW_REQUIRES_DESTINATION";
  if (!result.destinationCode) result.remainingRequirements.push("Select destination code from the approved G-CATS destination list");
  if (!result.materialUse) result.remainingRequirements.push("Confirm material / component use only if it is not present in the source IMDS record");
  if (!result.gadsl.length) result.remainingRequirements.push("Review CAS against GADSL result and retain evidence of the no-match");
  if (!result.tszGroups.length) result.remainingRequirements.push("Resolve Appendix 3 membership, including 'various' / TSZ table references where applicable");
  if (result.familyFlows.some(x => x.includes("dedicated table") || x === "Unmapped")) result.remainingRequirements.push("Open the referenced TSZ0001G dedicated table; do not infer the missing family flow");
  result.trace.push(...result.familyFlows.map(x => `Applicable family flow: ${x}`));
  result.trace.push(...result.appendices.map(x => `Appendix ${x.appendix}, TSZ ${x.tszNo}, source row ${x.sourceRow}`));
  return result;
}
