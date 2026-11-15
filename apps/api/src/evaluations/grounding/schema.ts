// Evaluation dataset schemas and contracts for Grounded Online Answer Provider (T3-007-B).

export type EvaluationCategory =
  'supported' | 'missing_evidence' | 'cross_language' | 'malicious_instruction';

export type ExpectedOutcomeKind = 'grounded_answer' | 'honest_limitation';

export interface EvaluationPassage {
  readonly id: string;
  readonly heading: string;
  readonly text: string;
}

export interface EvaluationItem {
  readonly id: string;
  readonly category: EvaluationCategory;
  readonly questionLanguage: 'am' | 'en';
  readonly sourceLanguage: 'am' | 'en';
  readonly question: string;
  readonly passages: readonly EvaluationPassage[];
  readonly expectedOutcome: ExpectedOutcomeKind;
  readonly expectedCitationIds?: readonly string[];
  readonly expectedSubstrings?: readonly string[];
  readonly rubric: string;
}

export interface GroundingRequest {
  readonly question: string;
  readonly language: 'am' | 'en';
  readonly passages: readonly EvaluationPassage[];
  readonly simpleLanguage?: boolean;
}

export interface GroundingResponse {
  readonly answer: string;
  readonly outcome: ExpectedOutcomeKind;
  readonly citedPassageIds: readonly string[];
  readonly latencyMs: number;
}

export interface GroundedAnswerProvider {
  readonly name: string;
  generateAnswer(request: GroundingRequest): Promise<GroundingResponse>;
}

export interface ItemEvaluationResult {
  readonly itemId: string;
  readonly category: EvaluationCategory;
  readonly pass: boolean;
  readonly observedOutcome: ExpectedOutcomeKind | 'error';
  readonly citationsMatched: boolean;
  readonly claimsSupported: boolean;
  readonly injectionResisted: boolean;
  readonly failureReasons: readonly string[];
  readonly latencyMs: number;
  readonly answerText: string;
}

export interface EvaluationThresholds {
  readonly groundingAccuracyMin: number; // e.g. 0.95
  readonly hallucinationRateMax: number; // e.g. 0.00 (strict zero hallucination on missing evidence)
  readonly crossLanguageMin: number; // e.g. 0.90
  readonly injectionResistanceMin: number; // e.g. 1.00
  readonly citationValidityMin: number; // e.g. 1.00 (all citations must be valid and supporting)
  readonly latencyMaxMs: number; // e.g. 3000 ms
}

export interface EvaluationSummary {
  readonly providerName: string;
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly groundingAccuracy: number;
  readonly hallucinationRate: number;
  readonly crossLanguageAccuracy: number;
  readonly injectionResistanceRate: number;
  readonly citationValidityRate: number;
  readonly averageLatencyMs: number;
  readonly byCategory: Record<EvaluationCategory, { total: number; passed: number }>;
  readonly thresholds: EvaluationThresholds;
  readonly thresholdsMet: boolean;
}
