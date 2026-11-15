// Automated delivery receipt and DLR webhook verification (T3-015-B, #84).
// Proves end-to-end receipt simulation for English (GSM-7) and Amharic Ge'ez (UCS-2),
// verifies AfroMessage DLR webhook handling (delivered, undelivered, expired, rejected, unknown/retry),
// and proves opt-out webhook parsing and pre-network message suppression.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AFROMESSAGE_OPT_OUT_KEYWORDS,
  AfroMessageSmsAdapter,
  checkSmsOptOut,
  InMemorySmsSuppressionRegistry,
  isSmsOptOutKeyword,
  parseAfroMessageDlrWebhook,
  parseAfroMessageInboundWebhook,
} from './afromessage-sms-adapter.ts';
import { analyzeSmsText } from '../domain/sms-encoding.ts';

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

describe('SMS Delivery Receipt & DLR Webhook Verification (T3-015-B)', () => {
  const dummyToken = 'secret-afromessage-live-token-proof';

  // ---------------------------------------------------------------------------
  // 1. End-to-end receipt simulation for English (GSM-7) & Amharic Ge'ez (UCS-2)
  // ---------------------------------------------------------------------------
  describe('1. End-to-end receipt simulation for English and Amharic messages', () => {
    it('proves single-segment English GSM-7 dispatch, gateway acceptance, and handset delivery receipt', async () => {
      const sendFixture = await loadFixture('afromessage-send-success.json');
      const dlrDeliveredFixture = await loadFixture('afromessage-dlr-webhook-delivered.json');

      const englishTemplate =
        'Track3: New job match for Python Tutor at Addis Dev. View details in portal.';
      const analysis = analyzeSmsText(englishTemplate);

      expect(analysis.encoding).toBe('GSM-7');
      expect(analysis.segmentCount).toBe(1);
      expect(analysis.characterCount).toBe(76);
      expect(analysis.characterCount).toBeLessThanOrEqual(160);

      const adapter = new AfroMessageSmsAdapter(
        { apiToken: dummyToken, senderName: 'Track3' },
        mockResponse(sendFixture),
      );

      // Phase 1: Outbound dispatch to Ethio Telecom subscriber (+2519...)
      const dispatchResult = await adapter.send({
        to: '+251911000001',
        message: englishTemplate,
        callbackUrl: 'https://api.example.com/api/delivery/sms/webhook',
      });

      expect(dispatchResult.ok).toBe(true);
      if (dispatchResult.ok) {
        expect(dispatchResult.status).toBe('queued');
        expect(dispatchResult.messageId).toBe('9ab2867c-96ce-4405-b890-8d35d52c8e01');
        expect(dispatchResult.encoding).toBe('GSM-7');
        expect(dispatchResult.segments).toBe(1);
        expect(dispatchResult.recipient).toBe('+251911000001');
      }

      // Phase 2: AfroMessage pushes DLR callback indicating carrier handset delivery
      const dlrEvent = adapter.handleDlrWebhook(dlrDeliveredFixture);

      expect(dlrEvent.messageId).toBe('9ab2867c-96ce-4405-b890-8d35d52c8e01');
      expect(dlrEvent.status).toBe('delivered');
      expect(dlrEvent.providerStatus).toBe('DELIVRD');
      expect(dlrEvent.recipient).toBe('+251911000001');
      expect(dlrEvent.isTerminal).toBe(true);
    });

    it('proves multi-segment English GSM-7 dispatch with 153-char UDH concatenation and receipt', async () => {
      const sendFixture = await loadFixture('afromessage-send-success.json');
      const dlrFixture = await loadFixture('afromessage-dlr-webhook-delivered.json');

      // 180 characters: exceeds 160, fits in 2 segments (180 / 153 = 2 segments)
      const multiSegmentEnglish =
        'Track3 Notification: You have been accepted for the inclusive Web Development Course starting next week in Addis Ababa. Please check your learner dashboard to verify accommodation setup.';
      const analysis = analyzeSmsText(multiSegmentEnglish);

      expect(analysis.encoding).toBe('GSM-7');
      expect(analysis.segmentCount).toBe(2);
      expect(analysis.concatenatedSegmentLimit).toBe(153);

      const adapter = new AfroMessageSmsAdapter(
        { apiToken: dummyToken },
        mockResponse(sendFixture),
      );

      const sendResult = await adapter.send({
        to: '0911000001',
        message: multiSegmentEnglish,
      });

      expect(sendResult.ok).toBe(true);
      if (sendResult.ok) {
        expect(sendResult.encoding).toBe('GSM-7');
        expect(sendResult.segments).toBe(2);
        expect(sendResult.status).toBe('queued');
      }

      // Carrier DLR confirms both concatenated segments arrived and assembled on handset
      const dlrResult = adapter.handleDlrWebhook(dlrFixture);
      expect(dlrResult.status).toBe('delivered');
      expect(dlrResult.isTerminal).toBe(true);
    });

    it("proves single-segment Amharic Ge'ez UCS-2 dispatch to Safaricom Ethiopia and receipt", async () => {
      const sendFixture = await loadFixture('afromessage-send-success.json');
      const dlrDeliveredFixture = await loadFixture('afromessage-dlr-webhook-delivered.json');

      const amharicTemplate = 'ትራክ3: አዲስ የስራ ማስታወቂያ አለ። ለመመልከት ወደ መተግበሪያው ይግቡ።';
      const analysis = analyzeSmsText(amharicTemplate);

      expect(analysis.encoding).toBe('UCS-2');
      expect(analysis.hasUnicode).toBe(true);
      expect(analysis.characterCount).toBe(47);
      expect(analysis.segmentCount).toBe(1);
      expect(analysis.singleMessageLimit).toBe(70);

      const adapter = new AfroMessageSmsAdapter(
        { apiToken: dummyToken },
        mockResponse(sendFixture),
      );

      // Dispatch to Safaricom Ethiopia prefix (+2517...)
      const dispatchResult = await adapter.send({
        to: '+251712345678',
        message: amharicTemplate,
      });

      expect(dispatchResult.ok).toBe(true);
      if (dispatchResult.ok) {
        expect(dispatchResult.encoding).toBe('UCS-2');
        expect(dispatchResult.segments).toBe(1);
        expect(dispatchResult.recipient).toBe('+251712345678');
      }

      const dlrEvent = adapter.handleDlrWebhook(dlrDeliveredFixture);
      expect(dlrEvent.status).toBe('delivered');
      expect(dlrEvent.isTerminal).toBe(true);
    });

    it("proves multi-segment Amharic Ge'ez UCS-2 dispatch with 67-char UDH concatenation and receipt", async () => {
      const sendFixture = await loadFixture('afromessage-send-success.json');
      const dlrFixture = await loadFixture('afromessage-dlr-webhook-delivered.json');

      // 97 characters Amharic Ge'ez: exceeds 70, fits in 2 segments (97 / 67 = 2 segments)
      const longAmharicText =
        'ትራክ3: የተከበሩ ተማሪ፣ ለአዲሱ የስራ እድል መመዘኛዎችን አሟልተዋል። ዝርዝሩን ለመመልከት እና ከአሰሪው ጋር ለመገናኘት እባክዎ መተግበሪያውን ይክፈቱ።';
      const analysis = analyzeSmsText(longAmharicText);

      expect(analysis.encoding).toBe('UCS-2');
      expect(analysis.characterCount).toBe(97);
      expect(analysis.segmentCount).toBe(2);
      expect(analysis.concatenatedSegmentLimit).toBe(67);

      const adapter = new AfroMessageSmsAdapter(
        { apiToken: dummyToken },
        mockResponse(sendFixture),
      );

      const sendResult = await adapter.send({
        to: '0912345678',
        message: longAmharicText,
      });

      expect(sendResult.ok).toBe(true);
      if (sendResult.ok) {
        expect(sendResult.encoding).toBe('UCS-2');
        expect(sendResult.segments).toBe(2);
      }

      const dlrResult = adapter.handleDlrWebhook(dlrFixture);
      expect(dlrResult.status).toBe('delivered');
      expect(dlrResult.isTerminal).toBe(true);
    });

    it('proves mixed English and Amharic text demotes entire payload to UCS-2 encoding', async () => {
      const sendFixture = await loadFixture('afromessage-send-success.json');
      const mixedText = 'Track3 Alert: ሰላም! Your tutor has answered your question.';
      const analysis = analyzeSmsText(mixedText);

      expect(analysis.encoding).toBe('UCS-2');
      expect(analysis.hasUnicode).toBe(true);
      expect(analysis.singleMessageLimit).toBe(70);

      const adapter = new AfroMessageSmsAdapter(
        { apiToken: dummyToken },
        mockResponse(sendFixture),
      );

      const sendResult = await adapter.send({
        to: '+251911000001',
        message: mixedText,
      });

      expect(sendResult.ok).toBe(true);
      if (sendResult.ok) {
        expect(sendResult.encoding).toBe('UCS-2');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 2. AfroMessage Delivery Report (DLR) Webhook Handling
  // ---------------------------------------------------------------------------
  describe('2. AfroMessage Delivery Report (DLR) webhook handling', () => {
    it('handles delivered DLR webhook fixture (DELIVRD -> delivered, terminal)', async () => {
      const fixture = await loadFixture('afromessage-dlr-webhook-delivered.json');
      const result = parseAfroMessageDlrWebhook(fixture);

      expect(result).toEqual({
        messageId: '9ab2867c-96ce-4405-b890-8d35d52c8e01',
        status: 'delivered',
        providerStatus: 'DELIVRD',
        recipient: '+251911000001',
        timestamp: new Date('2026-11-15T07:15:30.000Z'),
        isTerminal: true,
      });
    });

    it('handles undelivered DLR webhook fixture (UNDELIV -> undelivered, terminal)', async () => {
      const fixture = await loadFixture('afromessage-dlr-webhook-undeliv.json');
      const result = parseAfroMessageDlrWebhook(fixture);

      expect(result).toEqual({
        messageId: '9ab2867c-96ce-4405-b890-8d35d52c8e01',
        status: 'undelivered',
        providerStatus: 'UNDELIV',
        recipient: '+251911000001',
        timestamp: new Date('2026-11-15T07:15:35.000Z'),
        isTerminal: true,
      });
    });

    it('handles expired DLR webhook fixture (EXPIRED -> expired, terminal)', async () => {
      const fixture = await loadFixture('afromessage-dlr-webhook-expired.json');
      const result = parseAfroMessageDlrWebhook(fixture);

      expect(result).toEqual({
        messageId: '9ab2867c-96ce-4405-b890-8d35d52c8e01',
        status: 'expired',
        providerStatus: 'EXPIRED',
        recipient: '+251911000001',
        timestamp: new Date('2026-11-15T07:45:00.000Z'),
        isTerminal: true,
      });
    });

    it('handles rejected DLR webhook fixture with carrier errors (REJECTD -> rejected, terminal)', async () => {
      const fixture = await loadFixture('afromessage-dlr-webhook-rejected.json');
      const result = parseAfroMessageDlrWebhook(fixture);

      expect(result).toEqual({
        messageId: '9ab2867c-96ce-4405-b890-8d35d52c8e01',
        status: 'rejected',
        providerStatus: 'REJECTD',
        recipient: '+251911000001',
        errors: ['Destination number blocked by carrier firewall'],
        isTerminal: true,
      });
    });

    it('handles in-progress / queued statuses as non-terminal', () => {
      const queuedPayload = {
        acknowledge: 'success',
        response: {
          message_id: 'msg-in-progress-1',
          status: 'Send in progress...',
        },
      };

      const result = parseAfroMessageDlrWebhook(queuedPayload);
      expect(result.status).toBe('queued');
      expect(result.isTerminal).toBe(false);
    });

    it('handles flat webhook callbacks (unwrapped JSON)', () => {
      const flatPayload = {
        message_id: 'flat-id-456',
        status: 'DELIVRD',
        to: '+251911000001',
        timestamp: '2026-11-15T08:00:00Z',
      };

      const result = parseAfroMessageDlrWebhook(flatPayload);
      expect(result.status).toBe('delivered');
      expect(result.messageId).toBe('flat-id-456');
      expect(result.recipient).toBe('+251911000001');
      expect(result.isTerminal).toBe(true);
    });

    it('handles unknown carrier status codes gracefully without throwing', () => {
      const unknownPayload = {
        acknowledge: 'success',
        response: {
          message_id: 'msg-unknown-789',
          status: 'CARRIER_SUSPENDED_ROUTE',
        },
      };

      const result = parseAfroMessageDlrWebhook(unknownPayload);
      expect(result.status).toBe('unknown');
      expect(result.providerStatus).toBe('CARRIER_SUSPENDED_ROUTE');
      expect(result.isTerminal).toBe(false);
    });

    it('handles malformed, null, or empty payloads safely', () => {
      expect(parseAfroMessageDlrWebhook(null)).toEqual({
        messageId: undefined,
        status: 'unknown',
        providerStatus: 'invalid_payload',
        isTerminal: false,
      });

      expect(parseAfroMessageDlrWebhook({})).toEqual({
        messageId: undefined,
        status: 'unknown',
        providerStatus: 'unknown',
        isTerminal: false,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Opt-out webhook and message suppression
  // ---------------------------------------------------------------------------
  describe('3. Opt-out webhook handling and message suppression', () => {
    it('recognizes all standard English opt-out keywords case-insensitively', () => {
      expect(AFROMESSAGE_OPT_OUT_KEYWORDS).toContain('STOP');
      expect(AFROMESSAGE_OPT_OUT_KEYWORDS).toContain('አቁም');

      const englishKeywords = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'];

      for (const kw of englishKeywords) {
        expect(isSmsOptOutKeyword(kw)).toBe(true);
        expect(isSmsOptOutKeyword(kw.toLowerCase())).toBe(true);
        expect(isSmsOptOutKeyword(`  ${kw}  `)).toBe(true);
        expect(isSmsOptOutKeyword(`${kw}\n`)).toBe(true);
        expect(isSmsOptOutKeyword(`${kw} please`)).toBe(true);

        const check = checkSmsOptOut(kw);
        expect(check.isOptOut).toBe(true);
        expect(check.keyword).toBe(kw);
      }
    });

    it("recognizes Amharic Ge'ez opt-out keywords (አቁም, ተው)", () => {
      expect(isSmsOptOutKeyword('አቁም')).toBe(true);
      expect(isSmsOptOutKeyword('  አቁም  ')).toBe(true);
      expect(isSmsOptOutKeyword('ተው')).toBe(true);
      expect(isSmsOptOutKeyword('  ተው  \n')).toBe(true);
      expect(isSmsOptOutKeyword('አቁም እባክዎ')).toBe(true);
    });

    it('does not falsely trigger opt-out on regular keywords or messages', () => {
      expect(isSmsOptOutKeyword('HELP')).toBe(false);
      expect(isSmsOptOutKeyword('INFO')).toBe(false);
      expect(isSmsOptOutKeyword('ሰላም')).toBe(false);
      expect(isSmsOptOutKeyword('STOPWATCH')).toBe(false);
      expect(isSmsOptOutKeyword('NONSTOP')).toBe(false);
      expect(isSmsOptOutKeyword('')).toBe(false);
      expect(isSmsOptOutKeyword(undefined)).toBe(false);
    });

    it('parses inbound MO SMS opt-out fixture for STOP', async () => {
      const fixture = await loadFixture('afromessage-inbound-opt-out-stop.json');
      const result = parseAfroMessageInboundWebhook(fixture);

      expect(result).toEqual({
        sender: '+251911000001',
        recipient: '8008',
        message: 'STOP',
        isOptOut: true,
        optOutKeyword: 'STOP',
        messageId: 'mo-msg-optout-001',
        timestamp: new Date('2026-11-15T07:20:00.000Z'),
      });
    });

    it('parses inbound MO SMS opt-out fixture for Amharic አቁም', async () => {
      const fixture = await loadFixture('afromessage-inbound-opt-out-amharic.json');
      const result = parseAfroMessageInboundWebhook(fixture);

      expect(result).toEqual({
        sender: '+251712345678',
        recipient: '8008',
        message: 'አቁም',
        isOptOut: true,
        optOutKeyword: 'አቁም',
        messageId: 'mo-msg-optout-002',
        timestamp: new Date('2026-11-15T07:21:00.000Z'),
      });
    });

    it('automatically records suppression upon receiving inbound opt-out webhook', async () => {
      const suppressionRegistry = new InMemorySmsSuppressionRegistry();
      const adapter = new AfroMessageSmsAdapter({
        apiToken: dummyToken,
        suppressionRegistry,
      });

      const optOutFixture = await loadFixture('afromessage-inbound-opt-out-stop.json');

      expect(suppressionRegistry.isSuppressed('+251911000001')).toBe(false);

      const inboundResult = await adapter.handleInboundWebhook(optOutFixture);
      expect(inboundResult.isOptOut).toBe(true);

      // Verified suppressed in registry
      expect(suppressionRegistry.isSuppressed('+251911000001')).toBe(true);
      // Normalized lookup: also checks 0911000001 format
      expect(suppressionRegistry.isSuppressed('0911000001')).toBe(true);

      const record = suppressionRegistry.getRecord('0911000001');
      expect(record?.phone).toBe('+251911000001');
      expect(record?.reason).toContain('STOP');
    });

    it('blocks subsequent dispatches pre-network when number is suppressed (0 ETB cost, zero network calls)', async () => {
      const suppressionRegistry = new InMemorySmsSuppressionRegistry();
      suppressionRegistry.suppress('+251911000001', 'Learner sent STOP');

      let networkInvoked = false;
      const customFetch: typeof fetch = () => {
        networkInvoked = true;
        return Promise.resolve(new Response('{}'));
      };

      const adapter = new AfroMessageSmsAdapter(
        { apiToken: dummyToken, suppressionRegistry },
        customFetch,
      );

      // Attempt dispatch to suppressed recipient
      const result = await adapter.send({
        to: '0911000001',
        message: 'Track3 alert: new job match',
      });

      // Assert PRE-NETWORK rejection: no network invocation, zero carrier charge
      expect(networkInvoked).toBe(false);
      expect(result).toEqual({
        ok: false,
        permanent: true,
        status: 'rejected',
        error: 'Recipient has opted out of SMS alerts (message suppressed)',
      });
    });

    it('restores dispatch eligibility if learner unsuppresses (re-opts in)', async () => {
      const suppressionRegistry = new InMemorySmsSuppressionRegistry();
      suppressionRegistry.suppress('+251911000001');

      const sendFixture = await loadFixture('afromessage-send-success.json');
      const adapter = new AfroMessageSmsAdapter(
        { apiToken: dummyToken, suppressionRegistry },
        mockResponse(sendFixture),
      );

      // 1. While suppressed: rejected
      const suppressedResult = await adapter.send({
        to: '+251911000001',
        message: 'Hello',
      });
      expect(suppressedResult.ok).toBe(false);

      // 2. Learner opts back in
      suppressionRegistry.unsuppress('+251911000001');
      expect(suppressionRegistry.isSuppressed('+251911000001')).toBe(false);

      // 3. Dispatch succeeds
      const allowedResult = await adapter.send({
        to: '+251911000001',
        message: 'Hello',
      });
      expect(allowedResult.ok).toBe(true);
    });

    it('simulates outbox queue intent suppression upon opt-out', async () => {
      // Simulates how background delivery queue purges/suppresses pending intents for opted-out learners
      interface QueueItem {
        id: string;
        recipientPhone: string;
        status: 'pending' | 'suppressed' | 'dispatched';
      }

      const queue: QueueItem[] = [
        { id: 'intent-1', recipientPhone: '+251911000001', status: 'pending' },
        { id: 'intent-2', recipientPhone: '+251922000002', status: 'pending' },
        { id: 'intent-3', recipientPhone: '+251911000001', status: 'pending' },
      ];

      const suppressionRegistry = new InMemorySmsSuppressionRegistry();
      const adapter = new AfroMessageSmsAdapter({ apiToken: dummyToken, suppressionRegistry });

      // Inbound STOP from +251911000001
      const stopWebhook = { from: '0911000001', message: 'STOP' };
      const inbound = await adapter.handleInboundWebhook(stopWebhook);
      expect(inbound.isOptOut).toBe(true);

      // Outbox queue worker applies suppression filter
      for (const item of queue) {
        if (suppressionRegistry.isSuppressed(item.recipientPhone)) {
          item.status = 'suppressed';
        }
      }

      expect(queue[0]?.status).toBe('suppressed');
      expect(queue[1]?.status).toBe('pending'); // Different recipient unharmed
      expect(queue[2]?.status).toBe('suppressed');
    });
  });
});
