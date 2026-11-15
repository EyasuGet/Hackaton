import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AfroMessageSmsAdapter, mapAfroMessageStatus } from './afromessage-sms-adapter.ts';

const FIXTURES_DIR = fileURLToPath(new URL('../../../../../../fixtures/sms', import.meta.url));

async function loadFixture<T = unknown>(name: string): Promise<T> {
  const content = await readFile(resolve(FIXTURES_DIR, name), 'utf-8');
  return JSON.parse(content) as T;
}

function mockResponse(data: unknown, status = 200): typeof fetch {
  return () =>
    Promise.resolve(
      new Response(typeof data === 'string' ? data : JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
}

describe('mapAfroMessageStatus', () => {
  it('maps carrier receipt DELIVRD to delivered', () => {
    expect(mapAfroMessageStatus('DELIVRD')).toBe('delivered');
    expect(mapAfroMessageStatus('Delivered')).toBe('delivered');
  });

  it('maps carrier failure UNDELIV to undelivered', () => {
    expect(mapAfroMessageStatus('UNDELIV')).toBe('undelivered');
    expect(mapAfroMessageStatus('Undelivered')).toBe('undelivered');
  });

  it('maps gateway timeout EXPIRED to expired', () => {
    expect(mapAfroMessageStatus('EXPIRED')).toBe('expired');
  });

  it('maps operator rejection REJECTD to rejected', () => {
    expect(mapAfroMessageStatus('REJECTD')).toBe('rejected');
    expect(mapAfroMessageStatus('Rejected')).toBe('rejected');
  });

  it('maps gateway queue states to queued', () => {
    expect(mapAfroMessageStatus('Send in progress...')).toBe('queued');
    expect(mapAfroMessageStatus('QUEUED')).toBe('queued');
    expect(mapAfroMessageStatus('SENT')).toBe('queued');
  });

  it('maps unparseable or unrecognized states to unknown', () => {
    expect(mapAfroMessageStatus(undefined)).toBe('unknown');
    expect(mapAfroMessageStatus('')).toBe('unknown');
    expect(mapAfroMessageStatus('UNEXPECTED_CARRIER_CODE')).toBe('unknown');
  });
});

describe('AfroMessageSmsAdapter', () => {
  const dummyToken = 'secret-afromessage-test-token-12345';

  it('requires an API token on instantiation', () => {
    expect(() => new AfroMessageSmsAdapter({ apiToken: '' })).toThrow(
      'AfroMessage API token is required',
    );
  });

  describe('contract verification with documented fixtures', () => {
    it('successfully maps a valid send request from fixture', async () => {
      const fixture = await loadFixture('afromessage-send-success.json');
      let capturedUrl = '';
      let capturedHeaders: HeadersInit | undefined;
      let capturedBody = '';

      const customFetch: typeof fetch = (input, init) => {
        capturedUrl =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        capturedHeaders = init?.headers;
        capturedBody = typeof init?.body === 'string' ? init.body : '';
        return Promise.resolve(
          new Response(JSON.stringify(fixture), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      };

      const adapter = new AfroMessageSmsAdapter(
        { apiToken: dummyToken, senderName: 'Track3' },
        customFetch,
      );

      const result = await adapter.send({
        to: '0912345678',
        message: 'Track3 alert: new job vacancy matched',
      });

      expect(result).toEqual({
        ok: true,
        messageId: '9ab2867c-96ce-4405-b890-8d35d52c8e01',
        status: 'queued',
        providerStatus: 'Send in progress...',
        recipient: '+251912345678',
        encoding: 'GSM-7',
        segments: 1,
      });

      expect(capturedUrl).toBe('https://api.afromessage.com/api/send');
      const headersRecord = capturedHeaders as Record<string, string>;
      expect(headersRecord['Authorization']).toBe(`Bearer ${dummyToken}`);
      expect(JSON.parse(capturedBody)).toEqual({
        to: '+251912345678',
        message: 'Track3 alert: new job vacancy matched',
        sender: 'Track3',
      });
    });

    it('correctly detects Amharic UCS-2 encoding and segments on send', async () => {
      const fixture = await loadFixture('afromessage-send-success.json');
      const adapter = new AfroMessageSmsAdapter({ apiToken: dummyToken }, mockResponse(fixture));

      const result = await adapter.send({
        to: '+251712345678',
        message: 'ሰላም ተማሪ! አዲስ የስራ ማስታወቂያ አለ።',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.encoding).toBe('UCS-2');
        expect(result.segments).toBe(1);
        expect(result.recipient).toBe('+251712345678');
      }
    });

    it('maps provider unverified sender rejection fixture', async () => {
      const fixture = await loadFixture('afromessage-send-error-unverified-sender.json');
      const adapter = new AfroMessageSmsAdapter({ apiToken: dummyToken }, mockResponse(fixture));

      const result = await adapter.send({
        to: '0912345678',
        message: 'Test message',
        senderName: 'UnregisteredSender',
      });

      expect(result).toEqual({
        ok: false,
        permanent: true,
        status: 'rejected',
        error: 'Sender identifier not found or unverified',
        providerErrors: ['Sender identifier not found or unverified'],
      });
    });

    it('maps status check fixtures for DELIVRD, UNDELIV, EXPIRED, and REJECTD', async () => {
      const deliveredFixture = await loadFixture('afromessage-status-delivered.json');
      const undelivFixture = await loadFixture('afromessage-status-undeliv.json');
      const expiredFixture = await loadFixture('afromessage-status-expired.json');
      const rejectedFixture = await loadFixture('afromessage-status-rejected.json');

      const makeAdapter = (fixture: unknown) =>
        new AfroMessageSmsAdapter({ apiToken: dummyToken }, mockResponse(fixture));

      const delivResult = await makeAdapter(deliveredFixture).checkStatus('9ab2867c');
      expect(delivResult.status).toBe('delivered');
      expect(delivResult.providerStatus).toBe('DELIVRD');

      const undelivResult = await makeAdapter(undelivFixture).checkStatus('9ab2867c');
      expect(undelivResult.status).toBe('undelivered');
      expect(undelivResult.providerStatus).toBe('UNDELIV');

      const expiredResult = await makeAdapter(expiredFixture).checkStatus('9ab2867c');
      expect(expiredResult.status).toBe('expired');
      expect(expiredResult.providerStatus).toBe('EXPIRED');

      const rejectResult = await makeAdapter(rejectedFixture).checkStatus('9ab2867c');
      expect(rejectResult.status).toBe('rejected');
      expect(rejectResult.providerStatus).toBe('REJECTD');
    });

    it('maps status check not found error fixture to unknown', async () => {
      const notFoundFixture = await loadFixture('afromessage-status-not-found.json');
      const adapter = new AfroMessageSmsAdapter(
        { apiToken: dummyToken },
        mockResponse(notFoundFixture),
      );
      const result = await adapter.checkStatus('non-existent-id');

      expect(result.status).toBe('unknown');
      expect(result.providerStatus).toContain('Message not found');
    });
  });

  describe('pre-dispatch validation safeguards', () => {
    it('rejects invalid recipient format before network dispatch', async () => {
      let networkCalled = false;
      const customFetch: typeof fetch = () => {
        networkCalled = true;
        return Promise.resolve(new Response('{}'));
      };

      const adapter = new AfroMessageSmsAdapter({ apiToken: dummyToken }, customFetch);

      const result = await adapter.send({
        to: '+12025550123', // Non-Ethiopian
        message: 'Hello',
      });

      expect(networkCalled).toBe(false);
      expect(result).toEqual({
        ok: false,
        permanent: true,
        status: 'rejected',
        error: 'Only Ethiopian destination numbers (+251) are supported',
      });
    });

    it('rejects oversized message exceeding segmentation limits before network dispatch', async () => {
      let networkCalled = false;
      const customFetch: typeof fetch = () => {
        networkCalled = true;
        return Promise.resolve(new Response('{}'));
      };

      const adapter = new AfroMessageSmsAdapter(
        { apiToken: dummyToken, maxSegments: 2 },
        customFetch,
      );

      // In UCS-2, 2 segments is at most 134 chars. 150 chars requires 3 segments.
      const amharicOversized = 'ሰ'.repeat(150);
      const result = await adapter.send({
        to: '0912345678',
        message: amharicOversized,
      });

      expect(networkCalled).toBe(false);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.permanent).toBe(true);
        expect(result.status).toBe('rejected');
        expect(result.error).toContain('exceeds maximum UCS-2 Unicode segmentation limit');
      }
    });
  });

  describe('safe failure paths and unknown states', () => {
    it('retains unknown status on network timeouts so outbox worker can reconcile', async () => {
      const customFetch: typeof fetch = () => {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        return Promise.reject(error);
      };

      const adapter = new AfroMessageSmsAdapter({ apiToken: dummyToken }, customFetch);

      const result = await adapter.send({
        to: '0912345678',
        message: 'Test message',
      });

      expect(result).toEqual({
        ok: false,
        permanent: false,
        status: 'unknown',
        error: 'AfroMessage dispatch timed out',
      });
    });

    it('retains unknown status on rate limits (HTTP 429) and gateway errors (HTTP 502)', async () => {
      const makeAdapter = (statusCode: number) =>
        new AfroMessageSmsAdapter(
          { apiToken: dummyToken },
          mockResponse('Gateway error', statusCode),
        );

      const rateLimitResult = await makeAdapter(429).send({
        to: '0912345678',
        message: 'Test message',
      });
      expect(rateLimitResult).toEqual({
        ok: false,
        permanent: false,
        status: 'unknown',
        error: 'AfroMessage rate limit exceeded (HTTP 429)',
      });

      const serverErrorResult = await makeAdapter(502).send({
        to: '0912345678',
        message: 'Test message',
      });
      expect(serverErrorResult).toEqual({
        ok: false,
        permanent: false,
        status: 'unknown',
        error: 'AfroMessage gateway error (HTTP 502)',
      });
    });

    it('marks HTTP 401 authentication errors as permanent rejection without leaking secrets', async () => {
      const adapter = new AfroMessageSmsAdapter(
        { apiToken: dummyToken },
        mockResponse('Unauthorized', 401),
      );

      const result = await adapter.send({
        to: '0912345678',
        message: 'Test message',
      });

      expect(result).toEqual({
        ok: false,
        permanent: true,
        status: 'rejected',
        error: 'AfroMessage authentication failed (HTTP 401)',
      });
      // Verify token is never echoed in error string
      expect(JSON.stringify(result)).not.toContain(dummyToken);
    });

    it('handles status check network failure safely with unknown status', async () => {
      const customFetch: typeof fetch = () => Promise.reject(new Error('Connection reset'));

      const adapter = new AfroMessageSmsAdapter({ apiToken: dummyToken }, customFetch);
      const result = await adapter.checkStatus('msg-id-123');

      expect(result).toEqual({
        messageId: 'msg-id-123',
        status: 'unknown',
        providerStatus: 'network_error',
      });
    });
  });
});
