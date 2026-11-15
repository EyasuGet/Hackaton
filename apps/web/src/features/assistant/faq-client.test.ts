// Mapping of the tutoring answer response into the Reply model (T3-054).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAnswerClient } from './faq-client.ts';

describe('createAnswerClient', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('marks a reply as quoted only when the API flags a verbatim lesson excerpt', async () => {
    const body = (quoted?: boolean) => ({
      request: { id: 'r1', createdAt: '2026-11-15T12:00:00.000Z' },
      answer: 'Yes, but not in a passive way.',
      lang: 'en',
      kind: 'answered',
      provider: 'faq',
      citations: [],
      ...(quoted === undefined ? {} : { quoted }),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(body(true)))
      .mockResolvedValueOnce(Response.json(body()));
    vi.stubGlobal('fetch', fetchMock);
    const client = createAnswerClient({ courseId: 'course-1', getToken: () => 'token' });

    const quoted = await client.ask('Is the VA future good?');
    const written = await client.ask('What is a virtual assistant?');

    expect(quoted.kind === 'answer' && quoted.reply.quoted).toBe(true);
    expect(written.kind === 'answer' && written.reply.quoted).toBeUndefined();
  });
});
