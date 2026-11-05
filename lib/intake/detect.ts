import { isValidCas } from "@/lib/reference-data";
import { CAS_IN_TEXT } from "@/lib/intake/keys";

export type Field = "partNo" | "supplierCode" | "partName" | "errorType" | "cas" | "substanceName" | "contentPct" | "materialName" | "matlClass" | "componentPartName" | "applicationId" | "imdsMass" | "drawingMass" | "toleranceClass" | "destination";
export const FIELD_LABEL: Record<Field, string> = {
  partNo: "Delivery Part No.", supplierCode: "Supplier code", partName: "Part name", errorType: "Error Type", cas: "CAS No.", substanceName: "Substance name",
  contentPct: "Substance content", materialName: "Material name", matlClass: "IMDS Matl. Class", componentPartName: "Component part name", applicationId: "Application ID",
  imdsMass: "IMDS mass (g)", drawingMass: "Drawing mass (g)", toleranceClass: "Mass tol. class", destination: "Destination"
};
const ALIASES: Record<Field, string[]> = {
  partNo: ["deliverypartno", "deliverypartnumber", "partno", "partnumber", "partitemno", "itemno", "itemnumber", "toyotapartno", "tmcpartno", "partnoitem", "partnr"],
  supplierCode: ["suppliercode", "vendorcode", "suppliernumber", "supplierno", "vendorno"],
  partName: ["deliverypartname", "partname", "partdescription", "itemname", "description"],
  errorType: ["errortype", "errortypelabel", "errorcategory", "errorname"],
  cas: ["casno", "casnumber", "cas", "casregistry", "casregistrynumber", "casnr", "casrn"],
  substanceName: ["substancename", "substance", "chemicalname", "substancedescription", "nameofsubstance"],
  contentPct: ["substancecontent", "substancecontentwt", "content", "contentpct", "contentwt", "weightpercent", "wtpercent", "concentration", "percentage", "contentppm", "substancecontentppm"],
  materialName: ["materialname", "material", "materialdescription"],
  matlClass: ["imdsmatlclass", "matlclass", "materialclass", "imdsmaterialclass", "imdsmatlclassification"],
  componentPartName: ["componentpartname", "componentname", "component", "subcomponent", "componentdescription"],
  applicationId: ["applicationid", "applicationcode", "application", "applicationno"],
  imdsMass: ["imdsmassg", "imdsmass", "massg", "mass", "imdsweight", "weightg", "imdsweightg"],
  drawingMass: ["drawingmassg", "drawingmass", "drawingweight", "drawingweightg", "nominalmass", "drawingmassgnominal"],
  toleranceClass: ["masstolclass", "masstoleranceclass", "toleranceclass", "tolclass", "class", "masstol"],
  destination: ["destination", "vehicledestination", "region", "country", "market", "destinationcode"]
};
export const REQUIRED_ANY: Field[][] = [["partNo"], ["cas", "imdsMass"]];

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

export type ColumnGuess = { index: number; header: string; field: Field | null; confidence: number; how: string; alternatives: Field[] };
export type Detection = {
  headerRow: number | null; columns: ColumnGuess[]; mapping: Partial<Record<Field, number>>; confidence: number; needsConfirm: boolean;
  warnings: string[]; kinds: Array<"substance" | "mass" | "pb">; dataStart: number;
};

function headerScore(header: string): Array<{ field: Field; score: number }> {
  const n = norm(header);
  if (!n) return [];
  const out: Array<{ field: Field; score: number }> = [];
  for (const field of Object.keys(ALIASES) as Field[]) {
    let best = 0;
    for (const a of ALIASES[field]) {
      if (n === a) best = Math.max(best, 1);
      else if (a.length >= 5 && (n.startsWith(a) || n.endsWith(a))) best = Math.max(best, 0.8);
      else if (a.length >= 6 && n.includes(a)) best = Math.max(best, 0.7);
    }
    if (best) out.push({ field, score: best });
  }
  return out;
}

const isNum = (v: string) => /^-?\d+([.,]\d+)?\s*%?$/.test(v.trim());
function contentScore(field: Field, cells: string[]): number {
  const vals = cells.filter(Boolean);
  if (!vals.length) return 0;
  const share = (fn: (v: string) => boolean) => vals.filter(fn).length / vals.length;
  switch (field) {
    case "cas": return share((v) => (v.match(CAS_IN_TEXT) || []).length > 0);
    case "toleranceClass": return share((v) => /^M[A-F]$/i.test(v));
    case "contentPct": return share((v) => isNum(v) && parseFloat(v.replace(",", ".")) <= 100);
    case "imdsMass": case "drawingMass": return share(isNum);
    case "partNo": return share((v) => /^[A-Z0-9][A-Z0-9 \-./]{4,24}$/i.test(v) && /\d/.test(v));
    case "applicationId": return share((v) => /^\d{1,3}$/.test(v));
    case "destination": return share((v) => /^(EU|KR|CN|TW|IN|JP|OTH|OTHER|EUROPE|KOREA|CHINA|TAIWAN|INDIA|JAPAN)$/i.test(v));
    default: return 0.5;
  }
}

export function detectColumns(matrix: string[][]): Detection {
  const warnings: string[] = [];
  const width = matrix[0]?.length ?? 0;
  // 1. header row = row with the most recognised headers among the first 20
  let headerRow: number | null = null, bestHits = 1;
  for (let r = 0; r < Math.min(20, matrix.length); r++) {
    const hits = matrix[r].filter((c) => headerScore(c).some((g) => g.score >= 0.7)).length;
    if (hits > bestHits) { bestHits = hits; headerRow = r; }
  }
  const dataStart = headerRow === null ? 0 : headerRow + 1;
  const sample = matrix.slice(dataStart, dataStart + 300);
  const columns: ColumnGuess[] = [];
  for (let c = 0; c < width; c++) {
    const header = headerRow === null ? "" : matrix[headerRow][c];
    const cells = sample.map((r) => r[c] ?? "");
    const guesses = headerScore(header).map((g) => {
      const cs = contentScore(g.field, cells);
      const content = cells.some(Boolean) ? cs : 0.5;
      // header carries most weight; content check protects against a mislabeled column
      const conf = Math.min(1, g.score * (0.55 + 0.45 * Math.min(1, content / 0.6)));
      return { field: g.field, conf, how: `header "${header}"${cells.some(Boolean) ? ` · ${Math.round(content * 100)}% of cells look right` : ""}` };
    }).sort((a, b) => b.conf - a.conf);
    if (guesses.length) columns.push({ index: c, header, field: guesses[0].field, confidence: round(guesses[0].conf), how: guesses[0].how, alternatives: guesses.slice(1).map((g) => g.field) });
    else {
      // no usable header → try the content only for strongly patterned fields
      let hit: { field: Field; conf: number } | null = null;
      for (const f of ["cas", "toleranceClass", "destination"] as Field[]) {
        const cs = contentScore(f, cells);
        if (cs >= 0.8 && cells.filter(Boolean).length >= 1 && (!hit || cs > hit.conf)) hit = { field: f, conf: cs * 0.8 };
      }
      columns.push({ index: c, header, field: hit?.field ?? null, confidence: hit ? round(hit.conf) : 0, how: hit ? "values only (no header)" : "", alternatives: [] });
    }
  }
  // 2. one column per field: keep the strongest; a clear runner-up becomes ambiguity
  const mapping: Partial<Record<Field, number>> = {};
  let ambiguous = false;
  for (const field of Object.keys(ALIASES) as Field[]) {
    const cands = columns.filter((c) => c.field === field).sort((a, b) => b.confidence - a.confidence);
    if (!cands.length) continue;
    mapping[field] = cands[0].index;
    if (cands.length > 1) {
      if (cands[0].confidence - cands[1].confidence < 0.15) { ambiguous = true; warnings.push(`Two columns look like “${FIELD_LABEL[field]}” (“${cands[0].header || "col " + (cands[0].index + 1)}” and “${cands[1].header || "col " + (cands[1].index + 1)}”). Check which one to use; nothing was merged.`); }
      for (const extra of cands.slice(1)) { extra.alternatives.unshift(field); extra.field = null; }
    }
  }
  const dupHeaders = new Set<string>(); const seen = new Set<string>();
  if (headerRow !== null) for (const h of matrix[headerRow]) { const n = norm(h); if (!n) continue; if (seen.has(n)) dupHeaders.add(h); seen.add(n); }
  if (dupHeaders.size) warnings.push(`Duplicate column headers: ${Array.from(dupHeaders).join(", ")}. They were kept separate.`);
  if (headerRow === null) warnings.push("No header row was recognised. Columns were guessed from their values only — please confirm the mapping.");
  if (mapping.contentPct !== undefined) {
    const h = columns[mapping.contentPct].header.toLowerCase();
    if (!/%|wt|ppm|percent/.test(h)) warnings.push("Content column has no unit in its header; values were read as wt%.");
  }
  const kinds: Detection["kinds"] = [];
  if (mapping.cas !== undefined) kinds.push("substance");
  if (mapping.imdsMass !== undefined && (mapping.drawingMass !== undefined || mapping.toleranceClass !== undefined)) kinds.push("mass");
  if (mapping.applicationId !== undefined) kinds.push("pb");
  const mapped = Object.values(mapping).map((i) => columns[i!].confidence);
  const requiredOk = mapping.partNo !== undefined && (mapping.cas !== undefined || mapping.imdsMass !== undefined);
  const confidence = mapped.length && requiredOk ? Math.min(...mapped) : 0;
  const needsConfirm = !requiredOk || ambiguous || headerRow === null || confidence < 0.75;
  if (!requiredOk) warnings.push("Could not find both a Part No. column and either a CAS or a mass column. Pick the columns manually.");
  return { headerRow, columns, mapping, confidence: round(confidence), needsConfirm, warnings, kinds, dataStart };
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Cell → number text. Handles %, decimal comma, ppm (header-driven). */
export function numberText(v: string, ppm = false): string {
  let s = v.trim().replace(/%$/, "").trim();
  if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d+,\d+$/.test(s)) s = s.replace(",", ".");
  s = s.replace(/\s/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return "";
  return ppm ? String(parseFloat(s) / 10000) : s;
}
export function casCells(v: string): { cas: string[]; issue?: string } {
  const found = Array.from(new Set(v.match(CAS_IN_TEXT) || []));
  if (!found.length) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(v) || /^\d{1,2}[-/ ][A-Za-z]{3}$/.test(v) || /^[A-Za-z]{3}[-/ ]\d{2,4}$/.test(v)) return { cas: [], issue: `“${v}” looks like a date: Excel may have converted the CAS number. Re-copy the column as text.` };
    return { cas: [], issue: v ? `“${v}” is not a CAS number.` : undefined };
  }
  const bad = found.filter((c) => !isValidCas(c));
  if (bad.length) return { cas: found.filter(isValidCas), issue: `CAS check digit fails for ${bad.join(", ")} — check for a typing mistake.` };
  return { cas: found };
}
