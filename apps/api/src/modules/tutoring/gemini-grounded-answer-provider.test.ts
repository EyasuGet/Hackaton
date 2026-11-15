// Unit tests for GeminiGroundedAnswerProvider (T3-038).
// Verifies:
// 1. isAvailable() returns false without key.
// 2. When unavailable, requests fall back to labelled FAQ path without returning canned probe answers.
// 3. API key is passed via x-goog-api-key header, never in URL query parameters.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentAccess, type LessonReader } from '../content/application/content-access.ts';
import type { CitationResult, CitedSection, Passage } from '../content/domain/retrieval.ts';
import type { OwnedScope, Principal } from '../identity/domain/principal.ts';
import { FaqProvider } from './application/faq-provider.ts';
import type {
  ClaimRequestInput,
  ClaimResult,
  RecordOutcomeInput,
  TutoringRepository,
} from './application/ports/tutoring-repository.ts';
import { Tutoring } from './application/tutoring.ts';
import type { TutoringConversation } from './domain/conversation.ts';
import type { TutoringRequest } from './domain/tutoring-request.ts';
import { GeminiGroundedAnswerProvider } from './infrastructure/gemini-grounded-answer-provider.ts';

class InMemoryTutoringRepository implements TutoringRepository {
  readonly conversations: TutoringConversation[] = [];
  readonly requests: TutoringRequest[] = [];
  #counter = 1;

  createConversation(scope: OwnedScope, courseId: string): Promise<TutoringConversation | null> {
    if (!scope.courseIds.includes(courseId)) return Promise.resolve(null);
    const now = new Date();
    const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const conv: TutoringConversation = {
      id: `00000000-0000-0000-0000-${String(this.#counter++).padStart(12, '0')}`,
      ownerId: scope.ownerId,
      courseId,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: expires.toISOString(),
      purgedAt: null,
    };
    this.conversations.push(conv);
    return Promise.resolve(conv);
  }

  findConversation(
    scope: OwnedScope,
    conversationId: string,
  ): Promise<TutoringConversation | null> {
    const conv = this.conversations.find((c) => c.id === conversationId);
    if (!conv) return Promise.resolve(null);
    if (conv.ownerId !== scope.ownerId || !scope.courseIds.includes(conv.courseId)) {
      return Promise.resolve(null);
    }
    return Promise.resolve(conv);
  }

  async claimRequest(scope: OwnedScope, input: ClaimRequestInput): Promise<ClaimResult | null> {
    if (!scope.courseIds.includes(input.courseId)) return null;

    const existing = this.requests.find(
      (r) => r.ownerId === scope.ownerId && r.requestId === input.requestId,
    );
    if (existing) {
      return { kind: 'existing', request: existing };
    }

    let convId = input.conversationId;
    if (!convId) {
      const conv = await this.createConversation(scope, input.courseId);
      if (!conv) return null;
      convId = conv.id;
    } else {
      const conv = await this.findConversation(scope, convId);
      if (!conv || conv.courseId !== input.courseId) return null;
    }

    const now = new Date();
    const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const req: TutoringRequest = {
      id: `00000000-0000-0000-0000-${String(this.#counter++).padStart(12, '0')}`,
      conversationId: convId,
      ownerId: scope.ownerId,
      courseId: input.courseId,
      requestId: input.requestId,
      question: input.question,
      state: 'pending',
      answerText: null,
      answerLang: null,
      errorReason: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      completedAt: null,
      expiresAt: expires.toISOString(),
      purgedAt: null,
    };
    this.requests.push(req);
    return { kind: 'claimed', request: req };
  }

  findRequestById(scope: OwnedScope, id: string): Promise<TutoringRequest | null> {
    const req = this.requests.find((r) => r.id === id);
    if (!req) return Promise.resolve(null);
    if (req.ownerId !== scope.ownerId || !scope.courseIds.includes(req.courseId)) {
      return Promise.resolve(null);
    }
    return Promise.resolve(req);
  }

  findRequestByRequestId(scope: OwnedScope, requestId: string): Promise<TutoringRequest | null> {
    const req = this.requests.find((r) => r.requestId === requestId && r.ownerId === scope.ownerId);
    if (!req) return Promise.resolve(null);
    if (!scope.courseIds.includes(req.courseId)) return Promise.resolve(null);
    return Promise.resolve(req);
  }

  listHistory(scope: OwnedScope, courseId?: string): Promise<readonly TutoringRequest[]> {
    return Promise.resolve(
      this.requests.filter((r) => {
        if (r.ownerId !== scope.ownerId) return false;
        if (courseId && r.courseId !== courseId) return false;
        if (r.purgedAt !== null) return false;
        return scope.courseIds.includes(r.courseId);
      }),
    );
  }

  recordOutcome(
    scope: OwnedScope,
    requestId: string,
    outcome: RecordOutcomeInput,
  ): Promise<TutoringRequest | null> {
    const index = this.requests.findIndex((r) => r.id === requestId);
    if (index === -1) return Promise.resolve(null);
    const req = this.requests[index];
    if (!req || req.ownerId !== scope.ownerId || !scope.courseIds.includes(req.courseId)) {
      return Promise.resolve(null);
    }

    const now = new Date().toISOString();
    const updated: TutoringRequest = {
      ...req,
      state: outcome.state,
      answerText: outcome.answerText ?? null,
      answerLang: outcome.answerLang ?? null,
      errorReason: outcome.errorReason ?? null,
      updatedAt: now,
      completedAt: outcome.state === 'completed' ? now : req.completedAt,
    };
    this.requests[index] = updated;
    return Promise.resolve(updated);
  }

  clearHistory(scope: OwnedScope): Promise<void> {
    for (let i = this.conversations.length - 1; i >= 0; i--) {
      if (this.conversations[i]!.ownerId === scope.ownerId) this.conversations.splice(i, 1);
    }
    for (let i = this.requests.length - 1; i >= 0; i--) {
      if (this.requests[i]!.ownerId === scope.ownerId) this.requests.splice(i, 1);
    }
    return Promise.resolve();
  }

  purgeExpired(): Promise<number> {
    return Promise.resolve(0);
  }
}

const learner: Principal = {
  id: '00000000-0000-0000-0000-000000000001',
  role: 'learner',
  label: 'Learner One',
  demo: true,
  courseIds: ['course-1'],
};

function createMockContentAccess(): ContentAccess {
  const sections: CitedSection[] = [
    {
      sourceId: 'savanna-va1-future-of-va-industry',
      sectionId: 'artificial-intelligence-and-the-future-of-va-work',
      sourceTitle: 'The Future of the VA Industry',
      heading: 'Artificial Intelligence and the Future of VA Work',
      text: 'AI tools can assist with routine tasks including drafting emails, summarizing meetings, and organizing workflows.',
      language: 'en',
      courseId: 'course-1',
      version: 'starter-1',
      anchor: null,
      provenance: { kind: 'demo', note: 'test' },
    },
    {
      sourceId: 'savanna-va1-future-of-va-industry',
      sectionId: 'introduction',
      sourceTitle: 'The Future of the VA Industry',
      heading: 'Introduction',
      text: 'A virtual assistant refers to software or human professionals.',
      language: 'en',
      courseId: 'course-1',
      version: 'starter-1',
      anchor: null,
      provenance: { kind: 'demo', note: 'test' },
    },
  ];

  const reader: LessonReader = {
    // eslint-disable-next-line @typescript-eslint/require-await
    search: async (courseIds, question, _limit): Promise<Passage[]> => {
      void _limit;
      if (!courseIds.includes('course-1')) return [];
      if (question.toLowerCase().includes('routine')) {
        return sections;
      }
      return [];
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    resolve: async (courseIds, sourceId, sectionId): Promise<CitationResult> => {
      const match = sections.find(
        (s) =>
          s.sourceId === sourceId && s.sectionId === sectionId && courseIds.includes(s.courseId),
      );
      if (!match) return { kind: 'not_found' };
      return { kind: 'section', section: match };
    },
  };

  return new ContentAccess(reader, []);
}

describe('GeminiGroundedAnswerProvider Production AI Wiring (T3-038)', () => {
  const originalEnvKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    if (originalEnvKey !== undefined) {
      process.env.GEMINI_API_KEY = originalEnvKey;
    } else {
      delete process.env.GEMINI_API_KEY;
    }
    vi.restoreAllMocks();
  });

  describe('isAvailable()', () => {
    it('returns false when no API key is supplied or configured in environment', () => {
      const provider = new GeminiGroundedAnswerProvider();
      expect(provider.isAvailable()).toBe(false);
      expect(provider.apiKey).toBeUndefined();
    });

    it('returns false when API key is empty or whitespace-only', () => {
      const providerEmpty = new GeminiGroundedAnswerProvider('');
      expect(providerEmpty.isAvailable()).toBe(false);

      const providerWhitespace = new GeminiGroundedAnswerProvider('   ');
      expect(providerWhitespace.isAvailable()).toBe(false);
    });

    it('returns true when valid API key is supplied in constructor or environment', () => {
      const providerExplicit = new GeminiGroundedAnswerProvider('test-api-key');
      expect(providerExplicit.isAvailable()).toBe(true);
      expect(providerExplicit.apiKey).toBe('test-api-key');

      process.env.GEMINI_API_KEY = 'env-api-key';
      const providerEnv = new GeminiGroundedAnswerProvider();
      expect(providerEnv.isAvailable()).toBe(true);
      expect(providerEnv.apiKey).toBe('env-api-key');
    });
  });

  describe('fallback behaviour and removal of canned probe answers', () => {
    it('throws when generateAnswer is invoked directly without a configured API key', async () => {
      const provider = new GeminiGroundedAnswerProvider();
      expect(provider.isAvailable()).toBe(false);

      await expect(
        provider.generateAnswer({
          question: 'What routine tasks can AI help with?',
          language: 'en',
          passages: [],
        }),
      ).rejects.toThrow(
        'GeminiGroundedAnswerProvider is unavailable: GEMINI_API_KEY is not configured',
      );
    });

    it('falls back honestly to labelled FAQ path when GEMINI_API_KEY is unset and consent is given', async () => {
      const content = createMockContentAccess();
      const faq = new FaqProvider(content);
      const online = new GeminiGroundedAnswerProvider(); // No key: isAvailable() === false
      const repo = new InMemoryTutoringRepository();
      const tutoring = new Tutoring(repo, faq, online, content);

      // Question that in previous evaluation stubs matched tc-001-supp-en-ai-tasks
      const result = await tutoring.ask(learner, {
        courseId: 'course-1',
        requestId: 'req-fallback-to-faq',
        question: 'What routine tasks can AI help with?',
        externalConsent: true,
      });

      expect(result).not.toBeNull();
      // Must fall back honestly to the labelled FAQ provider, NOT online
      expect(result?.provider).toBe('faq');
      expect(result?.kind).toBe('answered');
      // Must NOT return the canned evaluation probe answer string from evaluations (tc-001-supp-en-ai-tasks)
      expect(result?.answerText).not.toContain(
        'According to the lesson, AI tools can assist Virtual Assistants',
      );
      expect(result?.answerText).not.toContain(
        '[artificial-intelligence-and-the-future-of-va-work]',
      );
      // Returns authentic FAQ answer retrieved from course content
      expect(result?.answerText).toContain('AI systems can assist Virtual Assistants');
      expect(result?.citations).toHaveLength(1);
      expect(result?.citations[0]?.sectionId).toBe(
        'artificial-intelligence-and-the-future-of-va-work',
      );
      expect(result?.request.state).toBe('completed');
    });

    it('falls back to FAQ honest limitation when question has no course evidence and GEMINI_API_KEY is unset', async () => {
      const content = createMockContentAccess();
      const faq = new FaqProvider(content);
      const online = new GeminiGroundedAnswerProvider();
      const repo = new InMemoryTutoringRepository();
      const tutoring = new Tutoring(repo, faq, online, content);

      // Question matching no course passages
      const result = await tutoring.ask(learner, {
        courseId: 'course-1',
        requestId: 'req-missing-evidence',
        question: 'What is the hourly rate in US dollars?',
        externalConsent: true,
      });

      expect(result).not.toBeNull();
      expect(result?.provider).toBe('faq');
      expect(result?.kind).toBe('insufficient_evidence');
      expect(result?.citations).toEqual([]);
      expect(result?.answerText).toContain('do not have an approved course answer');
    });
  });

  describe('API key leak protection (x-goog-api-key HTTP header)', () => {
    it('passes GEMINI_API_KEY in x-goog-api-key header and NEVER in URL query params', async () => {
      const secretKey = 'secret-production-gemini-key-xyz-987';
      const provider = new GeminiGroundedAnswerProvider({ apiKey: secretKey });

      const mockResponseData = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: 'According to the lesson, AI tools assist Virtual Assistants [artificial-intelligence-and-the-future-of-va-work].',
                },
              ],
            },
          },
        ],
      };

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponseData),
      } as unknown as Response);

      const result = await provider.generateAnswer({
        question: 'What routine tasks can AI tools help with?',
        language: 'en',
        passages: [
          {
            id: 'artificial-intelligence-and-the-future-of-va-work',
            heading: 'AI and VA Work',
            text: 'AI tools can assist with routine tasks.',
          },
        ],
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const [calledUrl, calledInit] = fetchSpy.mock.calls[0]!;

      // 1. URL must NOT contain the API key or query parameter '?key='
      const urlString =
        typeof calledUrl === 'string'
          ? calledUrl
          : calledUrl instanceof URL
            ? calledUrl.toString()
            : calledUrl.url;
      expect(urlString).not.toContain('key=');
      expect(urlString).not.toContain(secretKey);
      expect(urlString).toBe(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      );

      // 2. HTTP header must contain x-goog-api-key
      const headers = calledInit?.headers as Record<string, string>;
      expect(headers).toBeDefined();
      expect(headers['x-goog-api-key']).toBe(secretKey);
      expect(headers['Content-Type']).toBe('application/json');

      // 3. Result parsed accurately
      expect(result.outcome).toBe('grounded_answer');
      expect(result.citedPassageIds).toEqual(['artificial-intelligence-and-the-future-of-va-work']);
      expect(result.answer).toContain('According to the lesson');
    });

    it('detects honest limitation when model output indicates refusal without citations', async () => {
      const provider = new GeminiGroundedAnswerProvider({ apiKey: 'valid-test-key' });

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: 'The provided materials do not contain sufficient evidence to answer this question.',
                    },
                  ],
                },
              },
            ],
          }),
      } as unknown as Response);

      const result = await provider.generateAnswer({
        question: 'What is the hourly rate?',
        language: 'en',
        passages: [
          {
            id: 'general-intro',
            heading: 'Introduction',
            text: 'This course introduces basic concepts.',
          },
        ],
      });

      expect(result.outcome).toBe('honest_limitation');
      expect(result.citedPassageIds).toEqual([]);
      expect(result.answer).toContain('do not contain sufficient evidence');
    });

    it('throws error when Gemini API returns a non-200 HTTP response', async () => {
      const provider = new GeminiGroundedAnswerProvider({ apiKey: 'valid-test-key' });

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      } as unknown as Response);

      await expect(
        provider.generateAnswer({
          question: 'What is AI?',
          language: 'en',
          passages: [],
        }),
      ).rejects.toThrow('Gemini API HTTP error: 403 Forbidden');
    });
  });
});
