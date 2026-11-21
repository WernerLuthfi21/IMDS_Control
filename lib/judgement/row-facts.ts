/** Facts read from one G-CATS Error Log row. Keys in raw_source look like `${header} [col ${n}]`. */
export type RowFacts = {
  cas: string; substanceName: string; substanceContentPct: string; applicationId: string;
  materialName: string; matlClass: string; componentPartName: string; deliveryPartName: string;
  imdsMass: string; drawingMass: string; toleranceClass: string;
  drawingRefs: string[]; drawingStatus: string;
  companyName: string;
  /** G-CATS "(A)Mass" and "(B)Total Matl' Mass(g)" (Mass deviation rows). */
  componentMass?: string;
  totalMaterialMass?: string;
  /** Sum of the four REACH phthalates in the same material, from the other register rows of this part (set by the caller). */
  fourPhthalateTotal?: { pct: string; rows: number };
};

const CLASSES = ["MA", "MB", "MC", "MD", "ME", "MF"];

function text(raw: Record<string, unknown> | null | undefined, label: string, col: number): string {
  const value = raw?.[`${label} [col ${col}]`];
  if (value === null || value === undefined) return "";
  const s = String(value).replace(/_x000D_/g, " ").replace(/ /g, " ").trim();
  if (!s || s === "***" || /^#(N\/A|VALUE!|REF!|DIV\/0!)/i.test(s)) return "";
  return s;
}
function mass(raw: Record<string, unknown> | null | undefined, label: string, col: number): string {
  return text(raw, label, col).replace(/,/g, ".");
}

/** First non-empty value whose header starts with `label` (column numbers differ between log layouts). */
export function byHeader(raw: Record<string, unknown> | null | undefined, label: string): string {
  if (!raw) return "";
  for (const [k, v] of Object.entries(raw)) {
    if (!k.startsWith(label + " [col ")) continue;
    const s = String(v ?? "").replace(/_x000D_/g, " ").trim();
    if (s && s !== "***") return s;
  }
  return "";
}

export function extractRowFacts(raw: Record<string, unknown> | null | undefined): RowFacts {
  const max = mass(raw, "Drawing Mass(g)\nMax", 33);
  const min = mass(raw, "Drawing Mass(g)\nMin", 34);
  const cls = text(raw, "Mass Tol. Class", 52).toUpperCase();
  return {
    cas: text(raw, "CAS No.", 29),
    substanceName: text(raw, "Substance Name", 30),
    substanceContentPct: text(raw, "Substance Content(%)", 31),
    applicationId: text(raw, "Application ID", 32),
    materialName: text(raw, "Material Name", 26),
    matlClass: text(raw, "IMDS Matl. Class.", 27),
    componentPartName: text(raw, "Component Part Name", 22),
    deliveryPartName: text(raw, "Delivery Part Name", 18),
    imdsMass: mass(raw, "IMDS mass (g)", 51) || mass(raw, "Mass(g)", 19),
    drawingMass: mass(raw, "Drawing Mass (g)", 54) || (max && max === min ? max : ""),
    toleranceClass: CLASSES.includes(cls) ? cls : "",
    drawingRefs: [text(raw, "Drawing Info\nDrawing", 37), text(raw, "Drawing Info\nDrawing(2D)", 38), text(raw, "Drawing Info\nDrawing(3D)", 39)].filter(Boolean),
    drawingStatus: text(raw, "Drawing Info\nDrawing Status", 40),
    companyName: byHeader(raw, "Company Name"),
    componentMass: mass(raw, "(A)Mass", 23),
    totalMaterialMass: mass(raw, "(B)Total Matl' Mass(g)", 24)
  };
}
