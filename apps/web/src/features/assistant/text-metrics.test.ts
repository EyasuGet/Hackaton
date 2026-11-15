import { describe, expect, it, vi } from 'vitest';
import {
  isLightweightText,
  MAX_LIGHTWEIGHT_TEXT_BYTES,
  measureTextTransfer,
  PROFILE_3G,
} from './text-metrics.ts';
import { createFaqClient } from './faq-client.ts';

describe('Text path metrics and 3G profile (T3-008-B)', () => {
  it('defines the standard throttled 3G profile', () => {
    expect(PROFILE_3G.downloadKbps).toBe(750);
    expect(PROFILE_3G.uploadKbps).toBe(250);
    expect(PROFILE_3G.latencyMs).toBe(100);
  });

  it('measures text exchange and confirms lightweight transfer within budget', () => {
    const requestPayload = JSON.stringify({
      courseId: 'course-1',
      requestId: 'req-1731650000000-1',
      question: 'What is a virtual assistant?',
    });

    const responsePayload = JSON.stringify({
      request: {
        id: 'req-1731650000000-1',
        createdAt: '2026-09-11T12:00:00.000Z',
      },
      answer:
        'In some reports, a "virtual assistant" refers to AI software assistants such as chatbots. In other contexts, it refers to human remote professionals.',
      lang: 'en',
      citations: [
        {
          sourceId: 'savanna-va1-future-of-va-industry',
          sectionId: 'introduction',
          sourceTitle: 'The Future of the VA Industry',
          heading: 'Introduction',
        },
      ],
    });

    const metrics = measureTextTransfer(requestPayload, responsePayload);

    expect(metrics.requestBytes).toBeLessThan(200);
    expect(metrics.responseBytes).toBeLessThan(500);
    expect(metrics.totalBytes).toBeLessThan(MAX_LIGHTWEIGHT_TEXT_BYTES);
    expect(metrics.hasMedia).toBe(false);
    expect(isLightweightText(metrics)).toBe(true);
  });

  it('rejects text exchanges that include heavy media or exceed budget', () => {
    const bloatedMetrics = {
      requestBytes: 100,
      responseBytes: 10000,
      totalBytes: 10100,
      hasMedia: false,
    };
    expect(isLightweightText(bloatedMetrics)).toBe(false);

    const mediaMetrics = {
      requestBytes: 100,
      responseBytes: 200,
      totalBytes: 300,
      hasMedia: true,
    };
    expect(isLightweightText(mediaMetrics)).toBe(false);
  });

  it('reports failure honestly without false delivery on network disconnection', async () => {
    // Simulate network drop during throttled 3G operation
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch (network disconnected)')),
    );

    const client = createFaqClient({
      courseId: 'course-1',
      getToken: () => 'valid-token',
    });

    const result = await client.ask('What is photosynthesis?');

    // Must return failed, NEVER false delivery confirmation
    expect(result.kind).toBe('failed');

    vi.unstubAllGlobals();
  });

  it('produces exactly one logical answer after reconnect and retry', async () => {
    let callCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // First attempt fails due to connection drop
          return Promise.reject(new TypeError('Network error'));
        }
        // Second attempt after reconnect succeeds
        return Promise.resolve(
          Response.json({
            request: { id: 'req-reconnect-1', createdAt: '2026-11-15T00:00:00Z' },
            answer: 'Approved answer text',
            lang: 'en',
            citations: [],
          }),
        );
      }),
    );

    const client = createFaqClient({
      courseId: 'course-1',
      getToken: () => 'valid-token',
    });

    // Attempt 1: dropped
    const firstResult = await client.ask('Retry test question');
    expect(firstResult.kind).toBe('failed');

    // Attempt 2: reconnected retry
    const secondResult = await client.ask('Retry test question');
    expect(secondResult.kind).toBe('answer');
    if (secondResult.kind === 'answer') {
      expect(secondResult.reply.text).toBe('Approved answer text');
    }

    expect(callCount).toBe(2);
    vi.unstubAllGlobals();
  });
});
