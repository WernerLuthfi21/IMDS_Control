/**
 * The G-CATS "Detail" screen (TMC) per delivery part number: a header (Area Code, Supplier Code,
 * Delivery Part No., Bus. Ent., Company Name), one row per error (Check, Error Type, Comment,
 * Comment(last time), part/material/substance columns) and the SMS mass block.
 * The app prepares this for TMA to check; a person types the approved result into G-CATS.
 * Values come from the stored source row (`raw_source`, keys "<header> [col N]"), never invented.
 */
type Raw = Record<string, unknown> | null | undefined;

const clean = (v: unknown) => String(v ?? "").replace(/_x000D_/g, " ").replace(/\s+/g, " ").trim();
const keyNorm = (k: string) => k.replace(/\s*\[col \d+\]\s*$/, "").replace(/[\s\n]+/g, " ").trim().toLowerCase();

/** First non-empty source value whose header matches one of `labels` (whitespace and case insensitive). */
export function pick(raw: Raw, ...labels: string[]): string {
  if (!raw) return "";
  const want = labels.map((l) => l.replace(/\s+/g, " ").trim().toLowerCase());
  for (const w of want) {
    for (const [k, v] of Object.entries(raw)) {
      if (keyNorm(k) !== w) continue;
      const s = clean(v);
      if (s && s !== "***" && !/^#(N\/A|VALUE!|REF!)/i.test(s)) return s;
    }
  }
  return "";
}

export type DetailHeader = { areaCode: string; supplierCode: string; deliveryPartNo: string; busEnt: string; companyName: string };
export type DetailRow = {
  id: string; check: "OK" | "NG" | ""; errorType: string; comment: string; commentLastTime: string;
  deliveryPartName: string; mass: string; level: string; componentPartNo: string; componentPartName: string;
  materialName: string; matlClass: string; materialMass: string; cas: string; substanceName: string; contentPct: string; applicationId: string;
  sourceRecordKey: string;
};
export type DetailSms = { drawingMax: string; drawingMin: string; actualMax: string; actualMin: string; drawing: string; drawing2d: string; drawing3d: string; drawingStatus: string };
export type DetailInput = {
  id: string; source_record_key: string; error_type_label: string; delivery_part_no: string | null; supplier_code: string | null;
  judge: string | null; ok_comment: string | null; imds_reject_comment: string | null; raw_source: Raw;
};
export type PartDetail = { header: DetailHeader; rows: DetailRow[]; sms: DetailSms; decided: number; total: number };

export function headerOf(raw: Raw, row: Pick<DetailInput, "delivery_part_no" | "supplier_code">): DetailHeader {
  return {
    areaCode: pick(raw, "Area Code"),
    supplierCode: row.supplier_code || pick(raw, "Supplier Code"),
    deliveryPartNo: row.delivery_part_no || pick(raw, "Delivery Part No", "Delivery Part No."),
    busEnt: pick(raw, "Bus.Ent.", "Bus. Ent.", "Business Entity"),
    companyName: pick(raw, "Company Name")
  };
}

export function detailRowOf(r: DetailInput): DetailRow {
  const raw = r.raw_source;
  const j = (r.judge || "").toUpperCase();
  return {
    id: r.id,
    check: j === "OK" || j === "NG" ? j : "",
    errorType: r.error_type_label,
    comment: (j === "OK" ? r.ok_comment : j === "NG" ? r.imds_reject_comment : "") || "",
    commentLastTime: pick(raw, "Comment(last time)", "Comment (last time)"),
    deliveryPartName: pick(raw, "Delivery Part Name"),
    mass: pick(raw, "Mass(g)"),
    level: pick(raw, "Level"),
    componentPartNo: pick(raw, "Component Part No.", "Component Part No"),
    componentPartName: pick(raw, "Component Part Name"),
    materialName: pick(raw, "Material Name"),
    matlClass: pick(raw, "IMDS Matl. Class.", "IMDS Matl. Class"),
    materialMass: pick(raw, "Material Mass(g)"),
    cas: pick(raw, "CAS No.", "CAS No"),
    substanceName: pick(raw, "Substance Name"),
    contentPct: pick(raw, "Substance Content(%)"),
    applicationId: pick(raw, "Application ID"),
    sourceRecordKey: r.source_record_key
  };
}

export function smsOf(raw: Raw): DetailSms {
  return {
    drawingMax: pick(raw, "Drawing Mass(g) Max"), drawingMin: pick(raw, "Drawing Mass(g) Min"),
    actualMax: pick(raw, "Actual Mass(g) Max"), actualMin: pick(raw, "Actual Mass(g) Min"),
    drawing: pick(raw, "Drawing Info Drawing"), drawing2d: pick(raw, "Drawing Info Drawing(2D)"),
    drawing3d: pick(raw, "Drawing Info Drawing(3D)"), drawingStatus: pick(raw, "Drawing Info Drawing Status")
  };
}

/** One G-CATS Detail per delivery part number (+ supplier), rows in source order. */
export function buildPartDetails(items: DetailInput[]): PartDetail[] {
  const groups = new Map<string, DetailInput[]>();
  for (const it of items) {
    const k = (it.delivery_part_no || "").trim().toUpperCase() + "|" + (it.supplier_code || "").trim();
    const list = groups.get(k) ?? [];
    list.push(it); groups.set(k, list);
  }
  return [...groups.values()].map((list) => {
    const first = list.find((x) => x.raw_source) ?? list[0];
    const rows = list.map(detailRowOf);
    return { header: headerOf(first.raw_source, first), rows, sms: smsOf(first.raw_source), decided: rows.filter((r) => r.check).length, total: rows.length };
  }).sort((a, b) => a.header.deliveryPartNo.localeCompare(b.header.deliveryPartNo));
}

/** Columns of the Detail error table, in G-CATS order. */
export const DETAIL_COLUMNS: Array<[keyof DetailRow, string]> = [
  ["check", "Check"], ["errorType", "Error Type"], ["comment", "Comment"], ["commentLastTime", "Comment(last time)"],
  ["deliveryPartName", "Delivery Part Name"], ["mass", "Mass(g)"], ["level", "Level"], ["componentPartNo", "Component Part No."],
  ["componentPartName", "Component Part Name"], ["materialName", "Material Name"], ["matlClass", "IMDS Matl. Class."],
  ["materialMass", "Material Mass(g)"], ["cas", "CAS No."], ["substanceName", "Substance Name"], ["contentPct", "Substance Content(%)"],
  ["applicationId", "Application ID"]
];
