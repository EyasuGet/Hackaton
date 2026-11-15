// Contract between the learner interface and whatever answers questions.
// T3-006-A implemented with labelled demo fixtures;
// T3-007-A adds citations and consent-aware FAQ capability.

export interface Citation {
  readonly sourceId: string;
  readonly sectionId: string;
  readonly sourceTitle: string;
  readonly heading: string;
  readonly url?: string;
}

export interface Reply {
  readonly id: string;
  readonly text: string;
  /** BCP 47 language tag of the reply text, for example `am` or `en`. */
  readonly lang: string;
  /** Stored ISO 8601 instant; presentation must not rewrite it. */
  readonly createdAt: string;
  readonly citations?: readonly Citation[];
  readonly provider?: 'online' | 'faq' | 'job' | 'external_web_research';
  readonly provenance?: {
    readonly kind: 'external_web_research' | 'demo' | 'faq' | 'course' | 'job';
    readonly disclaimer?: string;
  };
}

/**
 * The three outcomes the interface must present differently. `denied` covers a
 * missing or expired session; `failed` covers network and server failures,
 * after which the learner may retry the same question.
 */
export type AskResult =
  | { readonly kind: 'answer'; readonly reply: Reply }
  | { readonly kind: 'denied' }
  | { readonly kind: 'failed' };

export type TranscriptionResult =
  | {
      readonly kind: 'transcribed';
      readonly transcript: string;
      readonly lang?: 'en' | 'am';
    }
  | { readonly kind: 'too_large' }
  | { readonly kind: 'unsupported_format' }
  | { readonly kind: 'denied' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'failed' };

export interface ConversationClient {
  /** Must not reject: report failures as `{ kind: 'failed' }`. */
  ask(question: string): Promise<AskResult>;
  /** Optional audio transcription endpoint (T3-010-B). */
  transcribe?(audioBase64: string, mimeType: string): Promise<TranscriptionResult>;
}
