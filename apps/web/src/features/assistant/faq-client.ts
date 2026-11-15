// Real HTTP ConversationClient connecting to the backend tutoring answers and FAQ endpoint
// (T3-007-A & T3-007-C).
// Retains atomic client-side requestId claims, session authorization, explicit external consent,
// and maps citations and provider provenance into the accessible Reply model.
import type { AskResult, Citation, ConversationClient, Reply } from './conversation.ts';

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function parseCitations(raw: unknown): Citation[] {
  if (!Array.isArray(raw)) return [];
  const citations: Citation[] = [];
  for (const item of raw) {
    const rec = record(item);
    if (
      rec &&
      typeof rec.sourceId === 'string' &&
      typeof rec.sectionId === 'string' &&
      typeof rec.sourceTitle === 'string' &&
      typeof rec.heading === 'string'
    ) {
      citations.push({
        sourceId: rec.sourceId,
        sectionId: rec.sectionId,
        sourceTitle: rec.sourceTitle,
        heading: rec.heading,
      });
    }
  }
  return citations;
}

export interface AnswerClientOptions {
  readonly courseId: string;
  readonly getToken: () => string | null;
  readonly getConsent?: () => boolean;
}

export function createAnswerClient({
  courseId,
  getToken,
  getConsent,
}: AnswerClientOptions): ConversationClient {
  let counter = 1;

  return {
    async ask(question: string): Promise<AskResult> {
      const token = getToken();
      if (!token) {
        return { kind: 'denied' };
      }

      const requestId = `req-${Date.now()}-${counter++}`;
      const externalConsent = getConsent ? getConsent() : false;

      try {
        const response = await fetch('/api/tutoring/answers', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            courseId,
            requestId,
            question,
            externalConsent,
          }),
        });

        if (response.status === 401 || response.status === 403) {
          return { kind: 'denied' };
        }

        if (!response.ok) {
          return { kind: 'failed' };
        }

        const data = record(await response.json());
        if (!data || typeof data.answer !== 'string') {
          return { kind: 'failed' };
        }

        const requestObj = record(data.request);
        const id = typeof requestObj?.id === 'string' ? requestObj.id : `ans-${Date.now()}`;
        const createdAt =
          typeof requestObj?.createdAt === 'string'
            ? requestObj.createdAt
            : new Date().toISOString();
        const lang = typeof data.lang === 'string' ? data.lang : 'en';
        const citations = parseCitations(data.citations);
        const provider =
          data.provider === 'online' || data.provider === 'faq' ? data.provider : undefined;

        const reply: Reply = {
          id,
          text: data.answer,
          lang,
          createdAt,
          ...(citations.length > 0 ? { citations } : {}),
          ...(provider ? { provider } : {}),
        };

        return { kind: 'answer', reply };
      } catch {
        return { kind: 'failed' };
      }
    },
  };
}

export function createFaqClient(options: {
  readonly courseId: string;
  readonly getToken: () => string | null;
}): ConversationClient {
  return createAnswerClient({ ...options, getConsent: () => false });
}
