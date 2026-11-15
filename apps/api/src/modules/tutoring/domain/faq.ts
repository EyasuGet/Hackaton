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

// Channels without a visual label (Telegram, SMS) say in words that a reply is a quote.
const QUOTE_LABELS = { en: 'Quoted from your course:', am: 'ከትምህርትዎ የተጠቀሰ፦' } as const;

/** `text`, introduced as a quote when `quoted`, so a fallback never passes as an approved answer. */
export function labelQuote(text: string, lang: 'en' | 'am', quoted: boolean | undefined): string {
  return quoted ? `${QUOTE_LABELS[lang]}\n${text}` : text;
}
