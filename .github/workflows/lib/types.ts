export type RecommendationState =
  | "RECOMMEND_OK"
  | "RECOMMEND_NG"
  | "MANUAL_REVIEW"
  | "HOLD"
  | "ESCALATE"
  | "AUTO_CHECKED_REVIEW_REQUIRED"
  | "DRAFT_RECOMMEND_OK"
  | "DRAFT_RECOMMEND_NG";

export type FinalDecision = "FINAL_OK" | "FINAL_NG" | "PENDING";

export interface JudgementEvaluation {
  nodeId: string;
  question: string;
  inputValue: unknown;
  branch: string;
  result: RecommendationState;
  source: string;
  sourcePage?: number;
  comment?: string;
  explanation: string;
}

export interface JudgementResult {
  caseId?: string;
  errorType: string | number;
  ruleId: string;
  ruleStatus: string;
  recommendation: RecommendationState;
  finalDecision: FinalDecision;
  comment?: string;
  reason: string;
  evaluations: JudgementEvaluation[];
  manualTasks: string[];
  sourceReferences: string[];
  isDemo: boolean;
}

export interface GcatErrorItem {
  sourceRow: number;
  sourceCaseCode?: string;
  errorType?: string;
  deliveryPartNo?: string;
  supplierCode?: string;
  companyName?: string;
  moduleId?: string;
  casNo?: string;
  substanceName?: string;
  judge?: string;
  comment?: string;
  raw: Record<string, unknown>;
}
