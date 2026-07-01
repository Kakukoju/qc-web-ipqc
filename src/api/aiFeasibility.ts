import { apiUrl } from './base';

const BASE = apiUrl('/v1/pre-assignment');

export interface FeasibilityPoint {
  patient_id?: string;
  conc?: number | null;
  od?: number | null;
  final_delta_od?: number | null;
}

export interface ResolutionCheck {
  passed: boolean;
  concResolution: number;
  rangeSpan: number;
  resolutionRatio?: number;
  resolutionRatioRI?: number;
  teaBudgetWorst?: number | null;
  teaBudgetLevel?: string | null;
  riPassed?: boolean;
  teaBudgetPassed?: boolean;
  opticalResolution: number;
  message: string;
}

export interface TeaLevelResult {
  level: string;
  assignedConc: number;
  meanFitted: number;
  biasPercent: number;
  cvPercent: number;
  biasAbs?: number;
  sdAbs?: number;
  tea: number;
  teaThreshold: number | null;
  teaMode?: 'percent' | 'absolute';
  passed: boolean | null;
}

export interface TeaCheck {
  passed: boolean;
  levels: TeaLevelResult[];
}

export interface ClinicalSpec {
  analyte_code: string;
  analyte_name: string | null;
  species: string;
  source_code: string;
  unit: string | null;
  tea_percent: number | null;
  tea_absolute: number | null;
  precision_cv_pct_limit: number | null;
  bias_pct_limit: number | null;
  reportable_min: number | null;
  reportable_max: number | null;
}

export interface AiAnalysisSections {
  executiveSummary?: string;
  deterministicQcResult?: string;
  failWarningFactors?: string;
  patternAnalysis?: string;
  recommendedActions?: string;
  qcReportDraft?: string;
}

export interface AiAnalysis {
  sections: AiAnalysisSections;
  provider?: string;
  modelId?: string;
  deterministicDecision?: string;
  requiresHumanReview: boolean;
  fallbackUsed: boolean;
}

export interface SuggestedFit {
  strategy: string;
  targetConc: number;
  usedConcs?: number[];
  fit: { slope: number; intercept: number; r2: number; n: number };
  teaCheck: TeaCheck;
  equation: string;
  improved: boolean;
}

export interface AlternativeSpec {
  source: string;
  species: string;
  tea_mode: string;
  tea_percent: number | null;
  tea_absolute: number | null;
  unit: string;
  aps_level: string;
  cv_percent?: number;
  passCount?: number | null;
  totalCount?: number | null;
  allPass?: boolean;
}

export interface FeasibilityResult {
  fit: { slope: number; intercept: number; r2: number; n: number };
  resolutionCheck: ResolutionCheck | null;
  teaCheck: TeaCheck | null;
  clinicalSpec: ClinicalSpec | null;
  residuals: Array<{ idx: number; patient_id: string; conc: number; od: number; predicted: number; residual: number; absResidual: number }>;
  needsAi: boolean;
  aiAnalysis: AiAnalysis | null;
  suggestedFits?: SuggestedFit[];
  alternativeSpecs?: AlternativeSpec[];
  teaOverride?: { source: string; tea_percent: number } | null;
}

export interface AutoFitIteration {
  iteration: number;
  fit: { slope: number; intercept: number; r2: number; n: number };
  teaCheck: TeaCheck | null;
  maxResidual: number;
  removedIndices: number[];
  pointCount: number;
  action: string;
  message: string;
  aiReason?: string;
}

export interface AutoFitResult {
  converged: boolean;
  iterations: AutoFitIteration[];
  finalFit: { slope: number; intercept: number; r2: number; n: number } | null;
  finalEquation: string | null;
  removedIndices: number[];
  finalPointCount: number;
  originalPointCount: number;
  teaCheck: TeaCheck | null;
  clinicalSpec: ClinicalSpec | null;
}

export async function runFeasibilityAnalysis(params: {
  points: FeasibilityPoint[];
  equation?: string;
  slope?: number;
  intercept?: number;
  r2?: number;
  analyze_item?: string;
  optical_resolution?: number;
  assigned_concs?: Record<string, number>;
  user_context?: string;
}): Promise<{ ok: boolean; data?: FeasibilityResult; error?: string }> {
  const res = await fetch(`${BASE}/ai-feasibility-analysis`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
}

export async function runAutoFit(params: {
  points: FeasibilityPoint[];
  analyze_item?: string;
  optical_resolution?: number;
  assigned_concs?: Record<string, number>;
  max_iterations?: number;
}): Promise<{ ok: boolean; data?: AutoFitResult; error?: string }> {
  const res = await fetch(`${BASE}/ai-auto-fit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
}
