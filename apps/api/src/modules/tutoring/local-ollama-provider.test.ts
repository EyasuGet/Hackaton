// Unit tests for LocalOllamaAnswerProvider and AnswerProvider factory (T3-037).
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  LocalOllamaAnswerProvider,
  normalizeOllamaEndpoint,
} from './infrastructure/local-ollama-provider.ts';
import { createAnswerProviders } from './infrastructure/provider-factory.ts';
import type { EvaluationPassage } from '../../evaluations/grounding/schema.ts';
import type { ContentAccess } from '../content/application/content-access.ts';

interface MockOllamaBody {
  model: string;
  temperature: number;
  messages: Array<{ role: string; content: string }>;
}

const SAMPLE_PASSAGES: readonly EvaluationPassage[] = [
  {
    id: 'intro-va',
    heading: 'Introduction to Virtual Assistance',
    text: 'A Virtual Assistant is a professional who provides administrative support remotely.',
  },
  {
    id: 'time-mgmt',
    heading: 'Time Management',
    text: 'Plan your day in advance and take regular breaks to maintain focus.',
  },
];

describe('normalizeOllamaEndpoint', () => {
  it('normalizes base host without path', () => {
    expect(normalizeOllamaEndpoint('http://localhost:11434')).toBe(
      'http://localhost:11434/v1/chat/completions',
    );
  });

  it('normalizes base host with trailing slash', () => {
    expect(normalizeOllamaEndpoint('http://localhost:11434/')).toBe(
      'http://localhost:11434/v1/chat/completions',
    );
  });

  it('normalizes base host with /v1', () => {
    expect(normalizeOllamaEndpoint('http://localhost:11434/v1')).toBe(
      'http://localhost:11434/v1/chat/completions',
    );
  });

  it('normalizes base host with /v1/', () => {
    expect(normalizeOllamaEndpoint('http://localhost:11434/v1/')).toBe(
      'http://localhost:11434/v1/chat/completions',
    );
  });

  it('preserves full path when already pointing to /chat/completions', () => {
    expect(normalizeOllamaEndpoint('http://localhost:11434/v1/chat/completions')).toBe(
      'http://localhost:11434/v1/chat/completions',
    );
  });

  it('handles custom hosts and ports', () => {
    expect(normalizeOllamaEndpoint('http://ollama-service:8080')).toBe(
      'http://ollama-service:8080/v1/chat/completions',
    );
  });
});

describe('LocalOllamaAnswerProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('identifies as a local provider with configured model name', () => {
    const provider = new LocalOllamaAnswerProvider({
      model: 'mistral:7b',
    });
    expect(provider.isLocal).toBe(true);
    expect(provider.name).toContain('mistral:7b');
  });

  it('formats prompt, sends OpenAI-compatible request, and parses citations', async () => {
    let capturedUrl = '';
    let capturedBody: unknown;

    const mockFetch = vi.fn().mockImplementation((url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init.body as string);
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [
              {
                message: {
                  content:
                    'Virtual Assistants work remotely [intro-va] and plan ahead [time-mgmt] [intro-va].',
                },
              },
            ],
          }),
      } as unknown as Response);
    });

    const provider = new LocalOllamaAnswerProvider({
      endpoint: 'http://localhost:11434',
      model: 'qwen2.5:3b',
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    const result = await provider.generateAnswer({
      question: 'What is a VA and how do they manage time?',
      language: 'en',
      passages: SAMPLE_PASSAGES,
      simpleLanguage: true,
    });

    const body = capturedBody as MockOllamaBody;
    expect(capturedUrl).toBe('http://localhost:11434/v1/chat/completions');
    expect(body.model).toBe('qwen2.5:3b');
    expect(body.temperature).toBe(0.1);
    expect(body.messages).toHaveLength(2);

    // Verify system prompt contains grounding and simplification instructions
    const systemPrompt = body.messages[0]?.content ?? '';
    expect(systemPrompt).toContain('Grounding constraints:');
    expect(systemPrompt).toContain('Simple language constraint:');
    expect(systemPrompt).toContain('Passage ID: intro-va');
    expect(systemPrompt).toContain('Passage ID: time-mgmt');

    // Verify user message
    const userPrompt = body.messages[1]?.content ?? '';
    expect(userPrompt).toContain('What is a VA and how do they manage time?');

    // Verify response parsing and citation deduplication
    expect(result.answer).toContain('Virtual Assistants work remotely');
    expect(result.outcome).toBe('grounded_answer');
    expect(result.citedPassageIds).toEqual(['intro-va', 'time-mgmt']);
  });

  it('detects honest limitation refusal when model cannot find answer in passages', async () => {
    const mockFetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [
              {
                message: {
                  content:
                    "I don't have enough information in the provided lesson materials to answer that question.",
                },
              },
            ],
          }),
      } as unknown as Response),
    );

    const provider = new LocalOllamaAnswerProvider({
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    const result = await provider.generateAnswer({
      question: 'What is the capital of France?',
      language: 'en',
      passages: SAMPLE_PASSAGES,
    });

    expect(result.outcome).toBe('honest_limitation');
    expect(result.citedPassageIds).toEqual([]);
  });

  it('detects Amharic refusal phrasing', async () => {
    const mockFetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [
              {
                message: {
                  content: 'ይቅርታ፣ ይህ መረጃ በቀረበው የትምህርት ክፍል ውስጥ አልተጠቀሰም።',
                },
              },
            ],
          }),
      } as unknown as Response),
    );

    const provider = new LocalOllamaAnswerProvider({
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    const result = await provider.generateAnswer({
      question: 'ጥያቄ',
      language: 'am',
      passages: SAMPLE_PASSAGES,
    });

    expect(result.outcome).toBe('honest_limitation');
    expect(result.citedPassageIds).toEqual([]);
  });

  it('throws descriptive error on HTTP non-200 response', async () => {
    const mockFetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: () => Promise.resolve('model not found'),
      } as unknown as Response),
    );

    const provider = new LocalOllamaAnswerProvider({
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    await expect(
      provider.generateAnswer({
        question: 'test question',
        language: 'en',
        passages: SAMPLE_PASSAGES,
      }),
    ).rejects.toThrow(/Ollama local model returned HTTP 500: model not found/);
  });

  it('throws descriptive error when connection fails (unreachable Ollama)', async () => {
    const mockFetch = vi
      .fn()
      .mockImplementation(() => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:11434')));

    const provider = new LocalOllamaAnswerProvider({
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    await expect(
      provider.generateAnswer({
        question: 'test question',
        language: 'en',
        passages: SAMPLE_PASSAGES,
      }),
    ).rejects.toThrow(/Local Ollama model is unreachable.*connect ECONNREFUSED/);
  });

  it('throws descriptive error on request timeout', async () => {
    const mockFetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      // Simulate timeout by triggering abort signal
      const signal = init.signal;
      if (signal) {
        const abortErr = new Error('The operation was aborted');
        abortErr.name = 'AbortError';
        return Promise.reject(abortErr);
      }
      return Promise.resolve({ ok: true } as Response);
    });

    const provider = new LocalOllamaAnswerProvider({
      timeoutMs: 50,
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    await expect(
      provider.generateAnswer({
        question: 'test question',
        language: 'en',
        passages: SAMPLE_PASSAGES,
      }),
    ).rejects.toThrow(/timed out/i);
  });

  it('serves synthetic probe responses when probeFallback is enabled', async () => {
    const provider = new LocalOllamaAnswerProvider({
      probeFallback: true,
    });

    const result = await provider.generateAnswer({
      question:
        'What specific routine administrative tasks can AI assist a Virtual Assistant with?',
      language: 'en',
      passages: [
        {
          id: 'artificial-intelligence-and-the-future-of-va-work',
          heading: 'AI in VA Work',
          text: 'AI assists with routine tasks.',
        },
      ],
    });

    expect(result.outcome).toBe('grounded_answer');
    expect(result.citedPassageIds).toContain('artificial-intelligence-and-the-future-of-va-work');
  });
});

describe('createAnswerProviders factory', () => {
  const dummyContentService = {} as unknown as ContentAccess;

  it('configures FaqProvider and omits online provider when AI_PROVIDER=faq', () => {
    const { faqProvider, onlineProvider } = createAnswerProviders(
      {
        provider: 'faq',
        localModelUrl: 'http://localhost:11434/v1',
        localModelName: 'qwen2.5:3b',
      },
      dummyContentService,
    );

    expect(faqProvider).toBeDefined();
    expect(onlineProvider).toBeUndefined();
  });

  it('configures LocalOllamaAnswerProvider with isLocal=true when AI_PROVIDER=local', () => {
    const { faqProvider, onlineProvider } = createAnswerProviders(
      {
        provider: 'local',
        localModelUrl: 'http://localhost:11434/v1',
        localModelName: 'qwen2.5:3b',
      },
      dummyContentService,
    );

    expect(faqProvider).toBeDefined();
    expect(onlineProvider).toBeDefined();
    expect(onlineProvider?.isLocal).toBe(true);
    expect(onlineProvider?.name).toContain('qwen2.5:3b');
  });

  it('configures Cloud Gemini provider when AI_PROVIDER=cloud', () => {
    const { faqProvider, onlineProvider } = createAnswerProviders(
      {
        provider: 'cloud',
        localModelUrl: 'http://localhost:11434/v1',
        localModelName: 'qwen2.5:3b',
      },
      dummyContentService,
    );

    expect(faqProvider).toBeDefined();
    expect(onlineProvider).toBeDefined();
    expect(onlineProvider?.isLocal).toBeUndefined();
  });
});
