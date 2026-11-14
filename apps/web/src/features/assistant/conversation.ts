// Contract between the learner interface and whatever answers questions.
// T3-006-A implements it only with labelled demo fixtures; the tutoring
// (T3-007) and identity (T3-004) work provide the real implementation later.

export interface Reply {
  readonly id: string;
  readonly text: string;
  /** BCP 47 language tag of the reply text, for example `am` or `en`. */
  readonly lang: string;
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

export interface ConversationClient {
  /** Must not reject: report failures as `{ kind: 'failed' }`. */
  ask(question: string): Promise<AskResult>;
}
