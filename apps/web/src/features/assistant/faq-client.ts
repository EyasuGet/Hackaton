// Real HTTP ConversationClient connecting to the backend tutoring FAQ endpoint (T3-007-A).
// Retains atomic client-side requestId claims, session authorization, and maps
// citations into the accessible Reply model.
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

export function createFaqClient({
  courseId,
  getToken,
}: {
  readonly courseId: string;
  readonly getToken: () => string | null;
}): ConversationClient {
  let counter = 1;

  return {
    async ask(question: string): Promise<AskResult> {
      const token = getToken();
      if (!token) {
        return { kind: 'denied' };
      }

      const requestId = `req-${Date.now()}-${counter++}`;

      try {
        const response = await fetch('/api/tutoring/faq', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            courseId,
            requestId,
            question,
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
        const id = typeof requestObj?.id === 'string' ? requestObj.id : `faq-${Date.now()}`;
        const createdAt =
          typeof requestObj?.createdAt === 'string'
            ? requestObj.createdAt
            : new Date().toISOString();
        const lang = typeof data.lang === 'string' ? data.lang : 'en';
        const citations = parseCitations(data.citations);

        const reply: Reply = {
          id,
          text: data.answer,
          lang,
          createdAt,
          ...(citations.length > 0 ? { citations } : {}),
        };

        return { kind: 'answer', reply };
      } catch {
        return { kind: 'failed' };
      }
    },
  };
}
