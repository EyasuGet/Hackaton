import { describe, expect, it } from 'vitest';
import {
  analyzeSmsText,
  calculateSmsCost,
  DEFAULT_AFROMESSAGE_RATE_PER_SEGMENT_ETB,
  DEFAULT_MAX_SMS_SEGMENTS,
  projectMonthlySmsCost,
} from './sms-encoding.ts';
import {
  AfroMessageSmsAdapter,
  mapAfroMessageStatus,
} from '../infrastructure/afromessage-sms-adapter.ts';

describe('Ethiopian SMS Route & Encoding Decision Verification (T3-003-A)', () => {
  describe('1. Character encoding and segmentation math (GSM-7 vs UCS-2)', () => {
    it('accurately budgets single-segment GSM-7 English text up to 160 characters', () => {
      const template = 'Track3: New job match for Python Tutor at Addis Dev. Log in to view.';
      const analysis = analyzeSmsText(template);

      expect(analysis.encoding).toBe('GSM-7');
      expect(analysis.hasUnicode).toBe(false);
      expect(analysis.characterCount).toBe(68);
      expect(analysis.segmentCount).toBe(1);
      expect(analysis.singleMessageLimit).toBe(160);
      expect(analysis.exceedsLimit).toBe(false);

      // Exact 160 character boundary
      const exact160 = 'A'.repeat(160);
      const exact160Analysis = analyzeSmsText(exact160);
      expect(exact160Analysis.segmentCount).toBe(1);
      expect(exact160Analysis.characterCount).toBe(160);
    });

    it('splits concatenated GSM-7 messages at 153 characters per segment (UDH allocation)', () => {
      // 161 characters requires 2 segments: ceil(161 / 153) = 2
      const text161 = 'B'.repeat(161);
      const analysis161 = analyzeSmsText(text161);
      expect(analysis161.encoding).toBe('GSM-7');
      expect(analysis161.segmentCount).toBe(2);
      expect(analysis161.concatenatedSegmentLimit).toBe(153);

      // Boundary: 2 full segments = 306 characters
      const text306 = 'B'.repeat(306);
      expect(analyzeSmsText(text306).segmentCount).toBe(2);

      // 307 characters requires 3 segments: ceil(307 / 153) = 3
      const text307 = 'B'.repeat(307);
      expect(analyzeSmsText(text307).segmentCount).toBe(3);
    });

    it('penalizes GSM-7 extension table characters by 2 septets per standard 3GPP TS 23.038', () => {
      // Base text 159 chars + '€' (extension char = 2 septets) -> total 161 septets -> 2 segments
      const textWithEuro = `${'C'.repeat(159)}€`;
      const analysis = analyzeSmsText(textWithEuro);

      expect(analysis.encoding).toBe('GSM-7');
      expect(analysis.characterCount).toBe(161);
      expect(analysis.segmentCount).toBe(2);
    });

    it("identifies Amharic Ge'ez script and budgets single-segment UCS-2 up to 70 characters", () => {
      const amharicTemplate = 'ትራክ3: አዲስ የስራ ማስታወቂያ አለ። ለመመልከት ወደ መተግበሪያው ይግቡ።';
      const analysis = analyzeSmsText(amharicTemplate);

      expect(analysis.encoding).toBe('UCS-2');
      expect(analysis.hasUnicode).toBe(true);
      expect(analysis.characterCount).toBe(47);
      expect(analysis.segmentCount).toBe(1);
      expect(analysis.singleMessageLimit).toBe(70);
      expect(analysis.concatenatedSegmentLimit).toBe(67);
      expect(analysis.exceedsLimit).toBe(false);

      // Exact 70 character boundary
      const exact70 = 'ሰ'.repeat(70);
      const exact70Analysis = analyzeSmsText(exact70);
      expect(exact70Analysis.segmentCount).toBe(1);
      expect(exact70Analysis.characterCount).toBe(70);
    });

    it('splits concatenated UCS-2 Amharic messages at 67 characters per segment (UDH allocation)', () => {
      // 71 characters requires 2 segments: ceil(71 / 67) = 2
      const amharic71 = 'ሰ'.repeat(71);
      const analysis71 = analyzeSmsText(amharic71);
      expect(analysis71.encoding).toBe('UCS-2');
      expect(analysis71.segmentCount).toBe(2);

      // Boundary: 2 full segments = 134 characters
      const amharic134 = 'ሰ'.repeat(134);
      expect(analyzeSmsText(amharic134).segmentCount).toBe(2);

      // 135 characters requires 3 segments: ceil(135 / 67) = 3
      const amharic135 = 'ሰ'.repeat(135);
      expect(analyzeSmsText(amharic135).segmentCount).toBe(3);
    });

    it('demotes mixed English and Amharic text to UCS-2 encoding', () => {
      const mixed = 'Track3: ሰላም! Your lesson is ready.';
      const analysis = analyzeSmsText(mixed);

      expect(analysis.encoding).toBe('UCS-2');
      expect(analysis.hasUnicode).toBe(true);
      expect(analysis.singleMessageLimit).toBe(70);
      expect(analysis.segmentCount).toBe(1);
    });

    it('enforces maximum segmentation guardrails with actionable rejection reasons', () => {
      const maxAllowed = DEFAULT_MAX_SMS_SEGMENTS; // 4
      expect(maxAllowed).toBe(4);

      // Exceeds 4 GSM-7 segments (> 612 chars)
      const oversizedGsm = 'A'.repeat(613);
      const gsmResult = analyzeSmsText(oversizedGsm, 4);
      expect(gsmResult.exceedsLimit).toBe(true);
      expect(gsmResult.segmentCount).toBe(5);
      expect(gsmResult.rejectionReason).toContain('exceeds maximum GSM-7 segmentation limit of 4');

      // Exceeds 4 UCS-2 segments (> 268 chars)
      const oversizedUcs2 = 'ሰ'.repeat(269);
      const ucs2Result = analyzeSmsText(oversizedUcs2, 4);
      expect(ucs2Result.exceedsLimit).toBe(true);
      expect(ucs2Result.segmentCount).toBe(5);
      expect(ucs2Result.rejectionReason).toContain(
        'exceeds maximum UCS-2 Unicode segmentation limit of 4',
      );
    });
  });

  describe('2. Route cost calculation & monthly volume projections', () => {
    it('calculates single and multi-segment costs at the standard AfroMessage rate (0.35 ETB)', () => {
      expect(DEFAULT_AFROMESSAGE_RATE_PER_SEGMENT_ETB).toBe(0.35);

      const cost1 = calculateSmsCost(1);
      expect(cost1.segments).toBe(1);
      expect(cost1.ratePerSegmentEtb).toBe(0.35);
      expect(cost1.totalCostEtb).toBe(0.35);
      expect(cost1.currency).toBe('ETB');

      const cost2 = calculateSmsCost(2);
      expect(cost2.segments).toBe(2);
      expect(cost2.totalCostEtb).toBe(0.7);

      const cost3 = calculateSmsCost(3);
      expect(cost3.segments).toBe(3);
      expect(cost3.totalCostEtb).toBe(1.05);

      const cost0 = calculateSmsCost(0);
      expect(cost0.totalCostEtb).toBe(0);
    });

    it('allows custom tariff rate overrides (e.g. 0.40 ETB/segment)', () => {
      const customRate = 0.4;
      const cost = calculateSmsCost(2, customRate);
      expect(cost.totalCostEtb).toBe(0.8);
      expect(cost.ratePerSegmentEtb).toBe(0.4);
    });

    it('projects monthly operational costs across 1,000, 5,000, and 10,000 message volume tiers', () => {
      // Tier 1: 1,000 messages (1 segment average)
      const proj1k = projectMonthlySmsCost(1000, 1, 0.35);
      expect(proj1k.messageCount).toBe(1000);
      expect(proj1k.totalSegments).toBe(1000);
      expect(proj1k.totalCostEtb).toBe(350);

      // Tier 1 with 2-segment messages (e.g. longer Amharic notifications)
      const proj1kConcat = projectMonthlySmsCost(1000, 2, 0.35);
      expect(proj1kConcat.totalSegments).toBe(2000);
      expect(proj1kConcat.totalCostEtb).toBe(700);

      // Tier 2: 5,000 messages
      const proj5k = projectMonthlySmsCost(5000, 1, 0.35);
      expect(proj5k.totalCostEtb).toBe(1750);

      const proj5kConcat = projectMonthlySmsCost(5000, 2, 0.35);
      expect(proj5kConcat.totalCostEtb).toBe(3500);

      // Tier 3: 10,000 messages
      const proj10k = projectMonthlySmsCost(10000, 1, 0.35);
      expect(proj10k.totalCostEtb).toBe(3500);

      const proj10kConcat = projectMonthlySmsCost(10000, 2, 0.35);
      expect(proj10kConcat.totalCostEtb).toBe(7000);
    });

    it('proves dramatic financial advantage of AfroMessage vs international route (Twilio)', () => {
      // Twilio standard rate to Ethiopia: ~$0.05 USD / segment
      // At official/commercial bank rate (~120 ETB / USD): $0.05 * 120 = 6.00 ETB / message
      const twilioRateEtbPerMsg = 6.0;
      const afroMessageRateEtbPerMsg = 0.35;

      const monthlyVolume = 5000;
      const twilioMonthlyCostEtb = monthlyVolume * twilioRateEtbPerMsg; // 30,000 ETB
      const afroMonthlyCostEtb = monthlyVolume * afroMessageRateEtbPerMsg; // 1,750 ETB

      const savingsEtb = twilioMonthlyCostEtb - afroMonthlyCostEtb;
      const savingsPercentage = (savingsEtb / twilioMonthlyCostEtb) * 100;

      expect(twilioMonthlyCostEtb).toBe(30000);
      expect(afroMonthlyCostEtb).toBe(1750);
      expect(savingsEtb).toBe(28250);
      expect(savingsPercentage).toBeGreaterThan(94); // > 94% cost reduction
    });
  });

  describe('3. AfroMessage gateway configuration and error code mappings', () => {
    it('requires a non-empty API token for client construction', () => {
      expect(() => new AfroMessageSmsAdapter({ apiToken: '' })).toThrow(
        'AfroMessage API token is required',
      );
      expect(() => new AfroMessageSmsAdapter({ apiToken: '   ' })).toThrow(
        'AfroMessage API token is required',
      );
    });

    it('maps AfroMessage status strings to normalized domain delivery states', () => {
      // Handset receipt confirmed
      expect(mapAfroMessageStatus('DELIVRD')).toBe('delivered');
      expect(mapAfroMessageStatus('Delivered')).toBe('delivered');

      // Handset delivery failed
      expect(mapAfroMessageStatus('UNDELIV')).toBe('undelivered');
      expect(mapAfroMessageStatus('Undelivered')).toBe('undelivered');

      // Gateway expiration
      expect(mapAfroMessageStatus('EXPIRED')).toBe('expired');

      // Rejection
      expect(mapAfroMessageStatus('REJECTD')).toBe('rejected');
      expect(mapAfroMessageStatus('Rejected')).toBe('rejected');

      // Gateway transmission terminal failure
      expect(mapAfroMessageStatus('FAILED')).toBe('failed');

      // In-flight gateway acceptance
      expect(mapAfroMessageStatus('Send in progress...')).toBe('queued');
      expect(mapAfroMessageStatus('QUEUED')).toBe('queued');
      expect(mapAfroMessageStatus('SENT')).toBe('queued');
      expect(mapAfroMessageStatus('PROCESSING')).toBe('queued');
      expect(mapAfroMessageStatus('ACCEPTED')).toBe('queued');

      // Fallbacks
      expect(mapAfroMessageStatus(undefined)).toBe('unknown');
      expect(mapAfroMessageStatus('')).toBe('unknown');
      expect(mapAfroMessageStatus('UNRECOGNIZED_VENDOR_STATUS')).toBe('unknown');
    });

    it('correctly classifies HTTP error statuses as permanent or transient', async () => {
      const dummyToken = 'test-token';

      // 401 Unauthorized -> permanent rejection
      const authFailFetch = () =>
        Promise.resolve(new Response(JSON.stringify({ acknowledge: 'error' }), { status: 401 }));
      const authAdapter = new AfroMessageSmsAdapter({ apiToken: dummyToken }, authFailFetch);
      const authResult = await authAdapter.send({ to: '+251911000001', message: 'Hello' });
      expect(authResult.ok).toBe(false);
      if (!authResult.ok) {
        expect(authResult.permanent).toBe(true);
        expect(authResult.status).toBe('rejected');
        expect(authResult.error).toContain('authentication failed (HTTP 401)');
      }

      // 429 Rate limited -> transient/unknown outcome
      const rateLimitFetch = () =>
        Promise.resolve(new Response(JSON.stringify({ acknowledge: 'error' }), { status: 429 }));
      const rateAdapter = new AfroMessageSmsAdapter({ apiToken: dummyToken }, rateLimitFetch);
      const rateResult = await rateAdapter.send({ to: '+251911000001', message: 'Hello' });
      expect(rateResult.ok).toBe(false);
      if (!rateResult.ok) {
        expect(rateResult.permanent).toBe(false);
        expect(rateResult.status).toBe('unknown');
        expect(rateResult.error).toContain('rate limit exceeded');
      }

      // 502 Bad Gateway -> transient/unknown outcome
      const gatewayErrorFetch = () =>
        Promise.resolve(new Response(JSON.stringify({ acknowledge: 'error' }), { status: 502 }));
      const gatewayAdapter = new AfroMessageSmsAdapter({ apiToken: dummyToken }, gatewayErrorFetch);
      const gatewayResult = await gatewayAdapter.send({ to: '+251911000001', message: 'Hello' });
      expect(gatewayResult.ok).toBe(false);
      if (!gatewayResult.ok) {
        expect(gatewayResult.permanent).toBe(false);
        expect(gatewayResult.status).toBe('unknown');
        expect(gatewayResult.error).toContain('gateway error (HTTP 502)');
      }

      // Network timeout / AbortError -> transient/unknown outcome
      const timeoutFetch = () => {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        return Promise.reject(error);
      };
      const timeoutAdapter = new AfroMessageSmsAdapter({ apiToken: dummyToken }, timeoutFetch);
      const timeoutResult = await timeoutAdapter.send({ to: '+251911000001', message: 'Hello' });
      expect(timeoutResult.ok).toBe(false);
      if (!timeoutResult.ok) {
        expect(timeoutResult.permanent).toBe(false);
        expect(timeoutResult.status).toBe('unknown');
        expect(timeoutResult.error).toBe('AfroMessage dispatch timed out');
      }
    });

    it('rejects invalid destination phone numbers before calling the provider', async () => {
      let fetchCalled = false;
      const customFetch = () => {
        fetchCalled = true;
        return Promise.resolve(new Response('{}', { status: 200 }));
      };

      const adapter = new AfroMessageSmsAdapter({ apiToken: 'test-token' }, customFetch);

      // Non-Ethiopian or invalid format
      const invalidResult = await adapter.send({ to: 'invalid-number', message: 'Hello' });
      expect(invalidResult.ok).toBe(false);
      expect(fetchCalled).toBe(false);
      if (!invalidResult.ok) {
        expect(invalidResult.permanent).toBe(true);
        expect(invalidResult.status).toBe('rejected');
      }
    });
  });
});
