import Decimal from "decimal.js";
import massRanges from "@/data/reference/tsz2900-mass-ranges.json";
import type { JudgementEvaluation, JudgementResult, RecommendationState } from "@/lib/types";

const SRC = {
  operation: "1.G-CATS Manual Operation Ver.6, Appendix I (Judgment procedure and criteria), PDF p.19",
  flow: "2.G-CATS Manual Flow Ver.6, Appendix II",
  mass: "Master Data All IMDS Project_new.xlsx, sheet Mass Check (TSZ2900), labelled TSZ2900G Rev.9",
  supplier: "G-CATS Manual Ver.6: supplier confirmation is required for this branch"
};

function evaluation(nodeId: string, question: string, inputValue: unknown, branch: string, result: RecommendationState, source: string, explanation: string, comment?: string, sourcePage?: number): JudgementEvaluation {
  return { nodeId, question, inputValue, branch, result, source, explanation, comment, sourcePage };
}

function baseResult(errorType: string | number, ruleId: string, ruleStatus: string, recommendation: RecommendationState, reason: string, evaluations: JudgementEvaluation[], manualTasks: string[], sourceReferences: string[], comment?: string): JudgementResult {
  return { errorType, ruleId, ruleStatus, recommendation, finalDecision: "PENDING", reason, evaluations, manualTasks, sourceReferences, comment, isDemo: false };
}

export function findMassTolerance(mass: string | number, toleranceClass: string) {
  const input = new Decimal(String(mass));
  const ranges = (massRanges as { ranges: Array<{minRaw:string;maxRaw:string;min:number;max:number;tolerances:Record<string,number|null>;sourceRow:number}> }).ranges;
  const row = ranges.find((range) => input.greaterThanOrEqualTo(new Decimal(range.minRaw)) && input.lessThanOrEqualTo(new Decimal(range.maxRaw)));
  if (!row) return { found: false as const, reason: "Mass does not fall in an imported TSZ2900 range." };
  const value = row.tolerances[toleranceClass.toUpperCase()];
  if (value === null || value === undefined) return { found: false as const, reason: `Tolerance class ${toleranceClass} is blank in the source row.` };
  return { found: true as const, tolerance: new Decimal(value), minRaw: row.minRaw, maxRaw: row.maxRaw, sourceRow: row.sourceRow, unit: "g", revision: (massRanges as {revision:string}).revision };
}

export type JudgementInput = {
  caseId?: string;
  errorType: number | string;
  sourceCatalog?: "none" | "system_error_check" | "appendix_judgement_criteria";
  supplierConfirmation?: "ACTUAL_OR_CALCULATED_MASS" | "INPUT_MISTAKE" | "SUPPLIER_CONFIRMED" | "OTHER";
  imdsMass?: string | number;
  drawingMass?: string | number;
  toleranceClass?: string;
  isRawMaterial?: boolean;
  drawingHeavierThanReference?: boolean;
  wildcardPercentage?: string | number;
  isToyotaSuppliedPart?: boolean;
  isImdsCommitteeMaterial?: boolean;
  isMultiMaterial?: boolean;
  baseMaterialWildcardPercentage?: string | number;
  componentPartMass?: string | number;
  totalMaterialMass?: string | number;
  approvedDeviationPercent?: string | number;
  applicationId?: string;
  destination?: string;
  policyOutcome?: "OK" | "NG" | "UNKNOWN";
  approvedApplication71?: boolean;
  sourceNote?: string;
};

export function evaluateJudgement(input: JudgementInput): JudgementResult {
  const et = String(input.errorType).trim();
  const n = Number(et.replace(/[^0-9]/g, ""));
  const commonSource = [SRC.operation, SRC.flow];

  // Source discrepancy: numeric Error Type 19 is always held. A UI selection must not silently resolve the collision.
  if (n === 19) {
    return baseResult(et, "RULE-19-CONFLICT", "HOLD_FOR_OWNER_RECONCILIATION", "HOLD",
      "Version 6 Section II lists No.19 as Prohibited substance(Benzene), while Appendix I lists No.19 as Application44ERROR. This numerical Error Type remains on HOLD until the process owner issues an approved mapping.",
      [evaluation("SRC-19", "Which source entry governs this case?", input.sourceCatalog || "not selected", "SOURCE_COLLISION", "HOLD", SRC.operation, "Do not choose between the conflicting Type 19 entries automatically.")],
      ["Confirm No.19 interpretation with G-CATS process owner", "Record approved source catalog and rule version"],
      [SRC.operation, "2.G-CATS Manual Flow Ver.6, Benzene-specific flow"]);
  }

  if (et === "Application44ERROR") {
    if (input.supplierConfirmation === "SUPPLIER_CONFIRMED") return baseResult(et, "RULE-APP19-APPLICATION44", "DRAFT_FOR_OWNER_APPROVAL", "RECOMMEND_OK", "Supplier confirmation recorded; human reviewer must verify supporting evidence.", [evaluation("APP19-SUPPLIER", "Supplier confirms the application/code?", input.supplierConfirmation, "SUPPLIER_CONFIRMED", "RECOMMEND_OK", SRC.operation, "Appendix I requests supplier confirmation.", "Confirmed by Supplier.", 19)], ["Attach supplier confirmation", "Human reviewer verifies final code/application context"], [SRC.operation], "Confirmed by Supplier.");
    if (input.supplierConfirmation === "INPUT_MISTAKE") return baseResult(et, "RULE-APP19-APPLICATION44", "DRAFT_FOR_OWNER_APPROVAL", "RECOMMEND_NG", "Supplier reports input mistake; the record requires correction and IMDS resubmission.", [evaluation("APP19-SUPPLIER", "Supplier reports input mistake?", input.supplierConfirmation, "INPUT_MISTAKE", "RECOMMEND_NG", SRC.operation, "Supplier confirmation branch; reviewer must validate evidence.")], ["Request corrected IMDS submission", "Human reviewer approves final NG"], [SRC.operation]);
    return baseResult(et, "RULE-APP19-APPLICATION44", "DRAFT_FOR_OWNER_APPROVAL", "MANUAL_REVIEW", "Supplier confirmation is required by Appendix I.", [evaluation("APP19-SUPPLIER", "Has supplier confirmed the application/code?", input.supplierConfirmation ?? null, "UNKNOWN", "MANUAL_REVIEW", SRC.operation, "Missing supplier confirmation routes to manual review.", undefined, 19)], ["Request supplier confirmation", "Attach response and reviewer approval"], [SRC.operation]);
  }

  if (n === 6 || et === "SMS Mass") {
    if (input.supplierConfirmation === "ACTUAL_OR_CALCULATED_MASS") return baseResult(et, "RULE-06-SMS-MASS", "DRAFT_FOR_OWNER_APPROVAL", "RECOMMEND_OK", "Supplier confirms actual or calculated mass.", [evaluation("SMS-6-A", "Supplier confirms actual/calculated mass?", input.supplierConfirmation, "A", "RECOMMEND_OK", SRC.flow, "The source flow indicates OK with this exact comment.", "Confirmed by Supplier.", 3)], ["Attach supplier response", "Human reviewer confirms evidence"], commonSource, "Confirmed by Supplier.");
    if (input.supplierConfirmation === "INPUT_MISTAKE") return baseResult(et, "RULE-06-SMS-MASS", "DRAFT_FOR_OWNER_APPROVAL", "RECOMMEND_NG", "Supplier confirms mass input mistake; IMDS correction/resubmission is required.", [evaluation("SMS-6-B", "Supplier confirms input mistake?", input.supplierConfirmation, "B", "RECOMMEND_NG", SRC.flow, "The source flow indicates NG and comment 'Mass is incorrect'.", "Mass is incorrect.", 3)], ["Request IMDS correction/resubmission", "Human reviewer approves final NG"], commonSource, "Mass is incorrect.");
    return baseResult(et, "RULE-06-SMS-MASS", "DRAFT_FOR_OWNER_APPROVAL", "MANUAL_REVIEW", "Supplier confirmation is required: A = actual/calculated mass; B = input mistake.", [evaluation("SMS-6", "Supplier response", input.supplierConfirmation ?? null, "UNKNOWN", "MANUAL_REVIEW", SRC.flow, "No supplier response; do not infer OK/NG.", undefined, 3)], ["Request supplier confirmation A/B", "Attach source response"], commonSource);
  }

  if (n === 7 || et === "Mass tolerance range") {
    if (input.imdsMass === undefined || input.drawingMass === undefined || !input.toleranceClass) return baseResult(et, "RULE-07-MASS-TOLERANCE", "DRAFT_FOR_OWNER_APPROVAL", "MANUAL_REVIEW", "IMDS mass, drawing mass, and tolerance class are required to calculate the tolerance comparison.", [evaluation("MASS-7-INPUT", "Are all source mass inputs available?", { imdsMass: input.imdsMass, drawingMass: input.drawingMass, toleranceClass: input.toleranceClass }, "UNKNOWN", "MANUAL_REVIEW", SRC.mass, "Missing source values are not treated as zero.")], ["Retrieve SMS-BR Drawing Search evidence", "Confirm TSZ2900G Rev.9 class/range is active", "Record source drawing and mass values"], [SRC.mass, "7.G-CATS operation - How to, PDF pages 21–25"]);
    const tol = findMassTolerance(input.drawingMass, input.toleranceClass);
    if (!tol.found) return baseResult(et, "RULE-07-MASS-TOLERANCE", "DRAFT_FOR_OWNER_APPROVAL", "HOLD", tol.reason, [evaluation("MASS-7-LOOKUP", "Does drawing mass resolve to a tolerance row?", input.drawingMass, "NO_MATCH", "HOLD", SRC.mass, tol.reason)], ["Check TSZ2900G source row and mass range"], [SRC.mass]);
    const delta = new Decimal(String(input.imdsMass)).minus(new Decimal(String(input.drawingMass))).abs();
    if (delta.lessThanOrEqualTo(tol.tolerance)) return baseResult(et, "RULE-07-MASS-TOLERANCE", "DRAFT_FOR_OWNER_APPROVAL", "RECOMMEND_OK", `Absolute mass difference ${delta.toString()} g is within source tolerance ±${tol.tolerance.toString()} g.`, [evaluation("MASS-7-COMPARE", "Is IMDS-to-drawing mass difference within tolerance?", { imdsMass: input.imdsMass, drawingMass: input.drawingMass, difference: delta.toString(), tolerance: tol.tolerance.toString(), class: input.toleranceClass, range: `${tol.minRaw}-${tol.maxRaw}` }, "WITHIN_TOLERANCE", "RECOMMEND_OK", SRC.mass, "Tolerance lookup uses the imported range row; verify the controlled revision before activation.", "Confirmed with Drawing.")], ["Reviewer validates drawing revision and tolerance class"], [SRC.mass], "Confirmed with Drawing.");
    if (input.isRawMaterial === true) {
      if (input.drawingHeavierThanReference === true) return baseResult(et, "RULE-07-MASS-TOLERANCE", "DRAFT_FOR_OWNER_APPROVAL", "RECOMMEND_OK", "Raw material branch: drawing comparison is marked heavier; reviewer must validate the visual branch.", [evaluation("MASS-7-RAW", "Raw material drawing heavier?", input.drawingHeavierThanReference, "YES", "RECOMMEND_OK", SRC.flow, "Manual flow shows OK with drawing confirmation on this branch.", "Confirmed with Drawing.", 3)], ["Attach drawing comparison", "Reviewer validates raw material branch"], [SRC.flow], "Confirmed with Drawing.");
      if (input.drawingHeavierThanReference === false) return baseResult(et, "RULE-07-MASS-TOLERANCE", "DRAFT_FOR_OWNER_APPROVAL", "RECOMMEND_NG", "Raw material branch: drawing comparison is not heavier; verify against the flow diagram before final decision.", [evaluation("MASS-7-RAW", "Raw material drawing heavier?", false, "NO", "RECOMMEND_NG", SRC.flow, "Manual flow branch points to NG; retain evidence and require reviewer.", undefined, 3)], ["Attach drawing comparison", "Reviewer validates raw material branch"], [SRC.flow]);
      return baseResult(et, "RULE-07-MASS-TOLERANCE", "DRAFT_FOR_OWNER_APPROVAL", "MANUAL_REVIEW", "Raw material branch requires a drawing comparison. This evidence is missing.", [evaluation("MASS-7-RAW", "Raw material drawing heavier?", null, "UNKNOWN", "MANUAL_REVIEW", SRC.flow, "Missing value cannot be interpreted as NO.", undefined, 3)], ["Obtain drawing mass comparison"], [SRC.flow]);
    }
    if (input.supplierConfirmation === "ACTUAL_OR_CALCULATED_MASS") return baseResult(et, "RULE-07-MASS-TOLERANCE", "DRAFT_FOR_OWNER_APPROVAL", "RECOMMEND_OK", "Supplier confirms actual/calculated mass.", [evaluation("MASS-7-SUPPLIER", "Supplier confirms actual/calculated mass?", input.supplierConfirmation, "A", "RECOMMEND_OK", SRC.flow, "Source flow indicates OK with supplier confirmation.", "Confirmed by Supplier.", 3)], ["Attach supplier response", "Reviewer validates supplier confirmation"], [SRC.flow], "Confirmed by Supplier.");
    if (input.supplierConfirmation === "INPUT_MISTAKE") return baseResult(et, "RULE-07-MASS-TOLERANCE", "DRAFT_FOR_OWNER_APPROVAL", "RECOMMEND_NG", "Supplier confirms input mistake.", [evaluation("MASS-7-SUPPLIER", "Supplier confirms input mistake?", input.supplierConfirmation, "B", "RECOMMEND_NG", SRC.flow, "Source flow indicates NG and 'Mass is incorrect'.", "Mass is incorrect.", 3)], ["Request corrected IMDS submission", "Reviewer approves final NG"], [SRC.flow]);
    return baseResult(et, "RULE-07-MASS-TOLERANCE", "DRAFT_FOR_OWNER_APPROVAL", "MANUAL_REVIEW", "Outside tolerance and not raw material: supplier response A/B is required.", [evaluation("MASS-7-SUPPLIER", "Supplier response", input.supplierConfirmation ?? null, "UNKNOWN", "MANUAL_REVIEW", SRC.flow, "No supplier response; do not infer branch.", undefined, 3)], ["Request supplier confirmation A/B"], [SRC.flow]);
  }

  if (n === 8 || et === "Mass deviation") {
    if (input.approvedDeviationPercent === undefined) return baseResult(et, "RULE-08-MASS-DEVIATION", "PARTIAL_MANUAL_REVIEW", "MANUAL_REVIEW", "The extracted source criterion is > ±1%, but the percentage denominator and rounding method are not explicitly specified. The application will not invent them.", [evaluation("MASS-8-BASIS", "Has the approved deviation percentage basis been supplied?", { componentPartMass: input.componentPartMass, totalMaterialMass: input.totalMaterialMass }, "BASIS_NOT_APPROVED", "MANUAL_REVIEW", SRC.operation, "Obtain the approved denominator and rounding convention before calculating.", undefined, 19)], ["Confirm calculation denominator with G-CATS process owner", "Confirm rounding method and boundary behavior"], [SRC.operation]);
    const pct = new Decimal(String(input.approvedDeviationPercent)).abs();
    const state = pct.greaterThan(1) ? "RECOMMEND_NG" : "AUTO_CHECKED_REVIEW_REQUIRED";
    return baseResult(et, "RULE-08-MASS-DEVIATION", "PARTIAL_MANUAL_REVIEW", state, `Approved percentage basis was supplied; deviation is ${pct.toString()}%. This remains a recommendation pending human review.`, [evaluation("MASS-8-PERCENT", "Is approved deviation > 1%?", pct.toString(), pct.greaterThan(1) ? "YES" : "NO", state, SRC.operation, "This calculation only executes when an approved percentage value is provided.", undefined, 19)], ["Attach calculation basis and source values", "Reviewer confirms the approved calculation method"], [SRC.operation]);
  }

  if (n === 9 || et === "Not specific substance" || et === "Not specified substances") {
    const ev: JudgementEvaluation[] = [];
    if (input.isToyotaSuppliedPart === true) {
      ev.push(evaluation("NS-1", "Is Material Name / part a TOYOTA supplied part?", true, "YES", "RECOMMEND_OK", SRC.flow, "Source flow indicates OK for Toyota supplied part.", "Component is ‘TOYOTA supplied part’", 4));
      return baseResult(et, "RULE-09-NOT-SPECIFIED", "DRAFT_FOR_OWNER_APPROVAL", "RECOMMEND_OK", "Toyota supplied part branch met.", ev, ["Reviewer confirms part classification"], [SRC.flow], "Component is ‘TOYOTA supplied part’");
    }
    if (input.isImdsCommitteeMaterial === true) {
      ev.push(evaluation("NS-2", "Is material IMDS-Committee / Stahl und Eisen Liste / ILI-Metals?", true, "YES", "RECOMMEND_OK", SRC.flow, "Source flow indicates OK for committee material.", "Material is IMDS Committee data", 4));
      return baseResult(et, "RULE-09-NOT-SPECIFIED", "DRAFT_FOR_OWNER_APPROVAL", "RECOMMEND_OK", "IMDS Committee material branch met.", ev, ["Reviewer confirms material classification"], [SRC.flow], "Material is IMDS Committee data");
    }
    if (input.wildcardPercentage === undefined) return baseResult(et, "RULE-09-NOT-SPECIFIED", "DRAFT_FOR_OWNER_APPROVAL", "MANUAL_REVIEW", "Wildcard percentage is missing; the Area Leader flow cannot be evaluated.", [evaluation("NS-3", "Is total not-specified substance percentage <= 10%?", null, "UNKNOWN", "MANUAL_REVIEW", SRC.flow, "A missing value is not treated as zero.", undefined, 4)], ["Retrieve material wildcard percentage and denominator"], [SRC.flow]);
    const p = new Decimal(String(input.wildcardPercentage));
    ev.push(evaluation("NS-3", "Is total not-specified substance percentage <= 10%?", p.toString(), p.lessThanOrEqualTo(10) ? "YES" : "NO", p.lessThanOrEqualTo(10) ? "RECOMMEND_OK" : "MANUAL_REVIEW", SRC.flow, "The source flow sets a 10% threshold.", p.lessThanOrEqualTo(10) ? "Not specified substances is 10% or less" : undefined, 4));
    if (p.lessThanOrEqualTo(10)) return baseResult(et, "RULE-09-NOT-SPECIFIED", "DRAFT_FOR_OWNER_APPROVAL", "RECOMMEND_OK", "Total not-specified substances is 10% or less.", ev, ["Reviewer confirms denominator / source material data"], [SRC.flow], "Not specified substances is 10% or less");
    if (input.isMultiMaterial === undefined) return baseResult(et, "RULE-09-NOT-SPECIFIED", "DRAFT_FOR_OWNER_APPROVAL", "MANUAL_REVIEW", "Total percentage exceeds 10%; multi-material classification is required.", ev, ["Confirm whether material is multi-material"], [SRC.flow]);
    if (!input.isMultiMaterial) return baseResult(et, "RULE-09-NOT-SPECIFIED", "DRAFT_FOR_OWNER_APPROVAL", "RECOMMEND_NG", "Total is above 10% and the material is not multi-material; source flow indicates no change from NG.", ev, ["Reviewer confirms source values and final NG"], [SRC.flow]);
    if (input.baseMaterialWildcardPercentage === undefined) return baseResult(et, "RULE-09-NOT-SPECIFIED", "DRAFT_FOR_OWNER_APPROVAL", "MANUAL_REVIEW", "Multi-material: base-material wildcard percentage is required.", ev, ["Retrieve base material percentage and denominator"], [SRC.flow]);
    const base = new Decimal(String(input.baseMaterialWildcardPercentage));
    ev.push(evaluation("NS-5", "Is base-material wildcard percentage <= 10%?", base.toString(), base.lessThanOrEqualTo(10) ? "YES" : "NO", base.lessThanOrEqualTo(10) ? "RECOMMEND_OK" : "RECOMMEND_NG", SRC.flow, "Source flow compares wildcard share in the base material.", undefined, 4));
    return baseResult(et, "RULE-09-NOT-SPECIFIED", "DRAFT_FOR_OWNER_APPROVAL", base.lessThanOrEqualTo(10) ? "RECOMMEND_OK" : "RECOMMEND_NG", "Multi-material base-material branch evaluated; human review is still required.", ev, ["Attach base-material evidence", "Reviewer confirms final decision"], [SRC.flow]);
  }

  if (n === 10 || et === "ELV (Pb)") {
    if (input.applicationId === "71") {
      const okInputs = input.approvedApplication71 === true;
      return baseResult(et, "RULE-10-PB-APP71", "MANUAL_REVIEW_REQUIRED", "MANUAL_REVIEW", "Application Code 71 has a dedicated aluminium/Pb <= 0.4 wt% and machining-purpose branch; the app will not decide without approved evidence.", [evaluation("PB-71", "Is Application 71 supporting evidence approved?", input.approvedApplication71 ?? null, okInputs ? "YES" : "UNKNOWN", "MANUAL_REVIEW", SRC.flow, "Source flow requires aluminum material classification, Pb content, and supplier machining-purpose confirmation.", undefined, 18)], ["Verify IMDS material classification 2.1.1 or 2.1.2", "Verify Pb <= 0.4 wt%", "Obtain supplier machining-purpose confirmation", "Escalate type-approval date to TMC if required"], [SRC.flow]);
    }
    if (input.policyOutcome === "OK" && input.destination && input.applicationId) return baseResult(et, "RULE-10-PB", "MANUAL_REVIEW_REQUIRED", "RECOMMEND_OK", "Pb policy row, Application ID, and destination have been entered as applicable; reviewer must verify the exact policy row and date.", [evaluation("PB-POLICY", "Does Pb Toyota Policy Table permit this Application ID and destination?", { applicationId: input.applicationId, destination: input.destination }, "POLICY_OK", "RECOMMEND_OK", SRC.flow, "Decision requires a matching Pb table row and verified destination.", "The substance is within exemption.", 9)], ["Attach exact Pb policy table row", "Confirm destination in New SMS", "Confirm EU type-approval date with TMC when relevant", "Reviewer approves final decision"], [SRC.flow], "The substance is within exemption.");
    if (input.policyOutcome === "NG") return baseResult(et, "RULE-10-PB", "MANUAL_REVIEW_REQUIRED", "MANUAL_REVIEW", "Policy row indicates NG; supplier confirmation and any required Toyota escalation must be recorded.", [evaluation("PB-POLICY", "Does policy row permit this application?", input.policyOutcome, "POLICY_NG", "MANUAL_REVIEW", SRC.flow, "NG branches may require supplier / TMC / TMA / TME / TMNA confirmation.", undefined, 9)], ["Obtain supplier explanation", "Escalate to appropriate Toyota owner", "Reviewer approves final decision"], [SRC.flow]);
    return baseResult(et, "RULE-10-PB", "MANUAL_REVIEW_REQUIRED", "MANUAL_REVIEW", "Application ID, verified destination, and exact Pb policy row are required. Do not infer type approval date.", [evaluation("PB-INPUT", "Are Application ID and verified destination present?", { applicationId: input.applicationId, destination: input.destination }, "UNKNOWN", "MANUAL_REVIEW", SRC.flow, "Missing values are routed to manual verification.", undefined, 9)], ["Retrieve Application ID from IMDS", "Verify destination using New SMS / TSZ6000G", "Look up exact Pb policy table row", "Ask TMC for type-approval date if required"], [SRC.flow]);
  }

  if ([11,12,13].includes(n)) return baseResult(et, `RULE-${n}-ELV`, "MANUAL_REVIEW_REQUIRED", "MANUAL_REVIEW", "ELV substance identified. Exact source flow and evidence must be reviewed; no final decision is automated.", [evaluation(`ELV-${n}`, "Is exact substance and supporting context verified?", input.sourceNote ?? null, "EXTERNAL_CONFIRMATION", "MANUAL_REVIEW", SRC.flow, "Manual or owner confirmation is required for applicability and final judgement.")], ["Verify CAS and material evidence", "Review corresponding Version 6 flow", "Obtain human confirmation and evidence"], commonSource);

  if (n === 14 || [15,16,17,18].includes(n) || /Prohibited substance/i.test(et)) return baseResult(et, "RULE-14-SUBSTANCE-SPECIFIC", "MANUAL_REVIEW_REQUIRED", "HOLD", "Prohibited-substance judgement is substance-specific. First run CAS → GADSL → TSZ → applicable family flow; no universal threshold is assumed.", [evaluation("SUB-LOOKUP", "Has CAS, GADSL, TSZ group, and specific flow been identified?", input.sourceNote ?? null, "UNKNOWN", "HOLD", "2.G-CATS Manual Flow Ver.6, Appendix II, substance lookup pages 6–8", "Missing or conflicting reference membership routes to HOLD.")], ["Search CAS in GADSL 2026 V1", "Find TSZ0001G group in Appendix 3", "Select POPs / REACH / dedicated flow", "Verify destination and material/use context", "Owner reviews final recommendation"], ["2.G-CATS Manual Flow Ver.6, Appendix II, pages 6–8", "Appendix 3–6 TSZ0001G reference workbooks"]);

  if ([1,2,3,4,5,20,21,22,23].includes(n)) return baseResult(et, `RULE-${String(n).padStart(2,"0")}-MANUAL`, "SOURCE_LISTED_MANUAL_CHECK", "MANUAL_REVIEW", "This Error Type requires source-system, supplier, purchasing, TMC or document verification. The application does not infer external facts.", [evaluation(`ET-${n}`, "Has the required source evidence been verified?", input.sourceNote ?? null, "UNKNOWN", "MANUAL_REVIEW", SRC.operation, "The source procedure requires human or external confirmation.")], ["Open the referenced SMS/WARP/New SMS/Purchasing evidence", "Record the source and reviewer", "Obtain final approval"], [SRC.operation]);

  return baseResult(et, "RULE-UNKNOWN", "UNMAPPED", "HOLD", "Error Type is not mapped to an approved rule. Retain the original label and request owner mapping.", [evaluation("UNKNOWN-ERROR-TYPE", "Is this Error Type mapped to an approved rule?", et, "NO", "HOLD", "Historical master workbook / source conflict register", "Unknown label is not silently assigned to another Error Type.")], ["Add label to source conflict register", "Obtain owner-approved mapping"], ["Master Data All IMDS Project_new.xlsx, G-CATS Error Log Master Data"]);
}
