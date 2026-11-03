/** Facts read from one G-CATS Error Log row. Keys in raw_source look like `${header} [col ${n}]`. */
export type RowFacts = {
  cas: string; substanceName: string; substanceContentPct: string; applicationId: string;
  materialName: string; componentPartName: string; deliveryPartName: string;
  imdsMass: string; drawingMass: string; toleranceClass: string;
  drawingRefs: string[]; drawingStatus: string;
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
    componentPartName: text(raw, "Component Part Name", 22),
    deliveryPartName: text(raw, "Delivery Part Name", 18),
    imdsMass: mass(raw, "IMDS mass (g)", 51) || mass(raw, "Mass(g)", 19),
    drawingMass: mass(raw, "Drawing Mass (g)", 54) || (max && max === min ? max : ""),
    toleranceClass: CLASSES.includes(cls) ? cls : "",
    drawingRefs: [text(raw, "Drawing Info\nDrawing", 37), text(raw, "Drawing Info\nDrawing(2D)", 38), text(raw, "Drawing Info\nDrawing(3D)", 39)].filter(Boolean),
    drawingStatus: text(raw, "Drawing Info\nDrawing Status", 40)
  };
}
