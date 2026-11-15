// Domain model for approved FAQs and answers with citations (T3-007-A).

export interface FaqCitation {
  readonly sourceId: string;
  readonly sectionId: string;
  readonly sourceTitle: string;
  readonly heading: string;
  readonly url?: string;
}

export interface FaqEntry {
  readonly id: string;
  readonly courseId: string;
  readonly language: 'en' | 'am';
  readonly patterns: readonly string[];
  readonly answer: string;
  readonly citations: readonly FaqCitation[];
}

export interface FaqAnswerResult {
  readonly kind: 'answered' | 'insufficient_evidence';
  readonly answerText: string;
  readonly answerLang: 'en' | 'am';
  readonly citations: readonly FaqCitation[];
  /** The text is a verbatim lesson excerpt, not an approved written answer (T3-054). */
  readonly quoted?: boolean;
}
