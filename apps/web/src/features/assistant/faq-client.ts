// Real HTTP ConversationClient connecting to the backend tutoring answers and FAQ endpoint
// (T3-007-A & T3-007-C).
// Retains atomic client-side requestId claims, session authorization, explicit external consent,
// and maps citations and provider provenance into the accessible Reply model.
import type {
  AskResult,
  Citation,
  ConversationClient,
  Reply,
  TranscriptionResult,
} from './conversation.ts';

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
        ...(typeof rec.url === 'string' ? { url: rec.url } : {}),
      });
    }
  }
  return citations;
}

export interface AnswerClientOptions {
  readonly courseId: string;
  readonly getToken: () => string | null;
  readonly getConsent?: () => boolean;
  readonly getSimpleLanguage?: () => boolean;
}

export function createAnswerClient({
  courseId,
  getToken,
  getConsent,
  getSimpleLanguage,
}: AnswerClientOptions): ConversationClient {
  let counter = 1;

  return {
    async ask(question: string, options?: { simpleLanguage?: boolean }): Promise<AskResult> {
      const token = getToken();
      if (!token) {
        return { kind: 'denied' };
      }

      const requestId = `req-${Date.now()}-${counter++}`;
      const externalConsent = getConsent ? getConsent() : false;
      const simpleLanguage =
        options?.simpleLanguage ?? (getSimpleLanguage ? getSimpleLanguage() : false);

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
            ...(simpleLanguage ? { simpleLanguage: true } : {}),
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
          data.provider === 'online' ||
          data.provider === 'faq' ||
          data.provider === 'job' ||
          data.provider === 'local'
            ? data.provider
            : undefined;
        const isSimple = data.simpleLanguage === true || simpleLanguage;

        const reply: Reply = {
          id,
          text: data.answer,
          lang,
          createdAt,
          ...(citations.length > 0 ? { citations } : {}),
          ...(provider ? { provider } : {}),
          ...(isSimple ? { simpleLanguage: true } : {}),
        };

        return { kind: 'answer', reply };
      } catch {
        return { kind: 'failed' };
      }
    },

    async transcribe(audioBase64: string, mimeType: string): Promise<TranscriptionResult> {
      const token = getToken();
      if (!token) {
        return { kind: 'denied' };
      }

      try {
        const response = await fetch('/api/tutoring/transcription', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            audio: audioBase64,
            mimeType,
          }),
        });

        if (response.status === 401 || response.status === 403) {
          return { kind: 'denied' };
        }
        if (response.status === 413) {
          return { kind: 'too_large' };
        }
        if (response.status === 503) {
          return { kind: 'unavailable' };
        }
        if (response.status === 400) {
          const body = record(await response.json().catch(() => null));
          if (body?.error === 'unsupported_format') {
            return { kind: 'unsupported_format' };
          }
          return { kind: 'failed' };
        }
        if (!response.ok) {
          return { kind: 'failed' };
        }

        const data = record(await response.json());
        if (!data || typeof data.transcript !== 'string') {
          return { kind: 'failed' };
        }

        const lang = data.lang === 'am' ? 'am' : 'en';
        return { kind: 'transcribed', transcript: data.transcript, lang };
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

export function createCareerResearchClient({
  getToken,
}: {
  readonly getToken: () => string | null;
}): ConversationClient {
  return {
    async ask(question: string): Promise<AskResult> {
      const token = getToken();
      if (!token) {
        return { kind: 'denied' };
      }

      try {
        const response = await fetch('/api/careers/research', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            query: question,
            consent: true,
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

        const lang = typeof data.lang === 'string' ? data.lang : 'en';
        const rawSources = Array.isArray(data.sources) ? data.sources : [];
        const citations: Citation[] = [];
        for (let idx = 0; idx < rawSources.length; idx++) {
          const s = record(rawSources[idx]);
          if (s) {
            const title =
              typeof s.title === 'string' && s.title.trim() ? s.title : 'External Source';
            const snippet =
              typeof s.snippet === 'string' && s.snippet.trim() ? s.snippet : 'Web Reference';
            const url = typeof s.url === 'string' ? s.url : undefined;
            citations.push({
              sourceId: `web-${idx + 1}`,
              sectionId: `external-${idx + 1}`,
              sourceTitle: title,
              heading: snippet,
              ...(url ? { url } : {}),
            });
          }
        }

        const provenanceObj = record(data.provenance);
        const disclaimer =
          typeof provenanceObj?.disclaimer === 'string' ? provenanceObj.disclaimer : undefined;

        const reply: Reply = {
          id: `research-${Date.now()}`,
          text: data.answer,
          lang,
          createdAt: new Date().toISOString(),
          ...(citations.length > 0 ? { citations } : {}),
          provider: 'external_web_research',
          provenance: {
            kind: 'external_web_research',
            ...(disclaimer ? { disclaimer } : {}),
          },
        };

        return { kind: 'answer', reply };
      } catch {
        return { kind: 'failed' };
      }
    },
  };
}
