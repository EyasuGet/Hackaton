// Port interface for online grounded answer generation (T3-007-C).
// Integrates external candidate providers (such as Gemini) behind a strict
// grounding boundary with explicit availability checks.
import type {
  EvaluationPassage,
  ExpectedOutcomeKind,
} from '../../../../evaluations/grounding/schema.ts';

export interface OnlineAnswerRequest {
  readonly question: string;
  readonly language: 'en' | 'am';
  readonly passages: readonly EvaluationPassage[];
  readonly simpleLanguage?: boolean;
}

export interface OnlineAnswerResponse {
  readonly answer: string;
  readonly outcome: ExpectedOutcomeKind;
  readonly citedPassageIds: readonly string[];
  readonly latencyMs?: number;
}

export interface OnlineAnswerProvider {
  readonly name: string;
  /** True when the provider runs locally on-host without external data transmission. */
  readonly isLocal?: boolean;
  /** Reports whether the external provider is currently configured and operational. */
  isAvailable(): boolean;
  /** Generates an answer strictly grounded in the supplied passages. */
  generateAnswer(request: OnlineAnswerRequest): Promise<OnlineAnswerResponse>;
}
