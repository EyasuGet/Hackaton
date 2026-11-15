// Unit tests for SmsJobAlertNotifier (T3-021-B).
// Verifies eligibility rechecks, suppression, formatting, error/retry policies, and provider dispatch.
import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import type { ClaimedDeliveryIntent } from '../domain/delivery-intent.ts';
import { SmsJobAlertNotifier } from './sms-job-alert-notifier.ts';
import type { SmsAdapter } from './ports/sms-adapter.ts';
import { InMemorySmsSuppressionRegistry } from '../infrastructure/afromessage-sms-adapter.ts';
import type { SendSmsRequest, SendSmsResult } from '../domain/sms-contract.ts';

function createMockPool(options: {
  subscriptionRow?: {
    subscription_id: string;
    subscription_active: boolean;
    unsubscribed_at: Date | null;
    destination: string | null;
    verified_phone: string | null;
  } | null;
  jobRow?: {
    id: string;
    withdrawn: boolean;
    expires_at: Date;
    title: string;
    organization: string;
    category: string;
    location: string;
    description: string;
    source_url: string;
  } | null;
}): pg.Pool {
  const query = vi.fn((sql: string) => {
    if (sql.includes('FROM job_subscriptions')) {
      return Promise.resolve({ rows: options.subscriptionRow ? [options.subscriptionRow] : [] });
    }
    if (sql.includes('FROM jobs j')) {
      return Promise.resolve({ rows: options.jobRow ? [options.jobRow] : [] });
    }
    return Promise.resolve({ rows: [] });
  });

  return { query } as unknown as pg.Pool;
}

function createIntent(overrides: Partial<ClaimedDeliveryIntent> = {}): ClaimedDeliveryIntent {
  return {
    id: 'intent-uuid-1',
    recipientId: 'learner-uuid-1',
    channel: 'sms',
    contentRef: 'job:job-va-01:1.0',
    contentExpiresAt: new Date(Date.now() + 86400000),
    attemptCount: 1,
    claimedBy: 'worker-1',
    claimedAt: new Date(),
    leaseExpiresAt: new Date(Date.now() + 30000),
    ...overrides,
  };
}

describe('SmsJobAlertNotifier', () => {
  const defaultSubRow = {
    subscription_id: 'sub-1',
    subscription_active: true,
    unsubscribed_at: null,
    destination: '+251911000001',
    verified_phone: '+251911000001',
  };

  const defaultJobRow = {
    id: 'job-va-01',
    withdrawn: false,
    expires_at: new Date(Date.now() + 86400000),
    title: 'Virtual Assistant Specialist',
    organization: 'Savanna Tech',
    category: 'Technology',
    location: 'Addis Ababa',
    description: 'Provide executive assistance',
    source_url: 'https://digitalbridge.et/jobs/job-va-01',
  };

  it('ignores delivery intents for non-SMS channels', async () => {
    const pool = createMockPool({});
    const sendMock = vi.fn();
    const smsAdapter: SmsAdapter = {
      providerName: 'AfroMessage',
      send: sendMock,
      checkStatus: vi.fn(),
    };

    const notifier = new SmsJobAlertNotifier({ pool, smsAdapter });
    const intent = createIntent({ channel: 'telegram' });

    const result = await notifier.dispatch(intent);
    expect(result).toEqual({ status: 'ignored', reason: 'unsupported_channel' });
    expect(await notifier.processClaimedIntent(intent)).toBe('complete');
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('ignores malformed content references', async () => {
    const pool = createMockPool({});
    const smsAdapter: SmsAdapter = {
      providerName: 'AfroMessage',
      send: vi.fn(),
      checkStatus: vi.fn(),
    };

    const notifier = new SmsJobAlertNotifier({ pool, smsAdapter });
    const intent = createIntent({ contentRef: 'help-reply:123' });

    const result = await notifier.dispatch(intent);
    expect(result).toEqual({ status: 'ignored', reason: 'invalid_content_ref' });
    expect(await notifier.processClaimedIntent(intent)).toBe('complete');
  });

  it('suppresses intents whose content has expired', async () => {
    const pool = createMockPool({});
    const smsAdapter: SmsAdapter = {
      providerName: 'AfroMessage',
      send: vi.fn(),
      checkStatus: vi.fn(),
    };

    const notifier = new SmsJobAlertNotifier({ pool, smsAdapter });
    const intent = createIntent({ contentExpiresAt: new Date(Date.now() - 1000) });

    const result = await notifier.dispatch(intent);
    expect(result).toEqual({ status: 'suppressed', reason: 'content_expired' });
    expect(await notifier.processClaimedIntent(intent)).toBe('complete');
  });

  it('suppresses alerts when the learner has unsubscribed or subscription is inactive', async () => {
    const pool = createMockPool({
      subscriptionRow: null, // No active subscription found
      jobRow: defaultJobRow,
    });
    const sendMock = vi.fn();
    const smsAdapter: SmsAdapter = {
      providerName: 'AfroMessage',
      send: sendMock,
      checkStatus: vi.fn(),
    };

    const notifier = new SmsJobAlertNotifier({ pool, smsAdapter });
    const result = await notifier.dispatch(createIntent());

    expect(result).toEqual({ status: 'suppressed', reason: 'unsubscribed_or_inactive' });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('suppresses alerts when the phone number is unverified', async () => {
    const pool = createMockPool({
      subscriptionRow: {
        ...defaultSubRow,
        verified_phone: null, // Phone not verified in learner_verified_phones
      },
      jobRow: defaultJobRow,
    });
    const sendMock = vi.fn();
    const smsAdapter: SmsAdapter = {
      providerName: 'AfroMessage',
      send: sendMock,
      checkStatus: vi.fn(),
    };

    const notifier = new SmsJobAlertNotifier({ pool, smsAdapter });
    const result = await notifier.dispatch(createIntent());

    expect(result).toEqual({ status: 'suppressed', reason: 'phone_unverified' });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('suppresses alerts when the job has been withdrawn', async () => {
    const pool = createMockPool({
      subscriptionRow: defaultSubRow,
      jobRow: {
        ...defaultJobRow,
        withdrawn: true,
      },
    });
    const sendMock = vi.fn();
    const smsAdapter: SmsAdapter = {
      providerName: 'AfroMessage',
      send: sendMock,
      checkStatus: vi.fn(),
    };

    const notifier = new SmsJobAlertNotifier({ pool, smsAdapter });
    const result = await notifier.dispatch(createIntent());

    expect(result).toEqual({ status: 'suppressed', reason: 'job_withdrawn_or_expired' });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('suppresses alerts when the destination phone is registered in suppression registry', async () => {
    const pool = createMockPool({
      subscriptionRow: defaultSubRow,
      jobRow: defaultJobRow,
    });
    const suppressionRegistry = new InMemorySmsSuppressionRegistry();
    suppressionRegistry.suppress('+251911000001', 'Inbound opt-out');

    const sendMock = vi.fn();
    const smsAdapter: SmsAdapter & { suppressionRegistry: InMemorySmsSuppressionRegistry } = {
      providerName: 'AfroMessage',
      suppressionRegistry,
      send: sendMock,
      checkStatus: vi.fn(),
    };

    const notifier = new SmsJobAlertNotifier({ pool, smsAdapter });
    const result = await notifier.dispatch(createIntent());

    expect(result).toEqual({ status: 'suppressed', reason: 'opted_out' });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('dispatches formatted SMS alert on successful validation', async () => {
    const pool = createMockPool({
      subscriptionRow: defaultSubRow,
      jobRow: defaultJobRow,
    });

    const sendMock = vi.fn<(req: SendSmsRequest) => Promise<SendSmsResult>>().mockResolvedValue({
      ok: true,
      messageId: 'afro_msg_001',
      status: 'queued',
      providerStatus: 'Send in progress...',
      recipient: '+251911000001',
      encoding: 'GSM-7',
      segments: 1,
    });

    const smsAdapter: SmsAdapter = {
      providerName: 'AfroMessage',
      send: sendMock,
      checkStatus: vi.fn(),
    };

    const notifier = new SmsJobAlertNotifier({ pool, smsAdapter });
    const intent = createIntent();

    const result = await notifier.dispatch(intent);
    expect(result).toEqual({
      status: 'delivered',
      messageId: 'afro_msg_001',
      recipient: '+251911000001',
      encoding: 'GSM-7',
      segments: 1,
    });

    expect(sendMock).toHaveBeenCalledOnce();
    const callArgs = sendMock.mock.calls[0]?.[0];
    expect(callArgs?.to).toBe('+251911000001');
    expect(callArgs?.idempotencyKey).toBe(intent.id);
    expect(callArgs?.message).toContain('Job Alert: Virtual Assistant Specialist at Savanna Tech');
    expect(callArgs?.message).toContain('https://digitalbridge.et/jobs/job-va-01');
    expect(callArgs?.message).toContain('STOP to opt out');

    // Worker maps delivered outcome to 'complete'
    expect(await notifier.processClaimedIntent(intent)).toBe('complete');
  });

  it('formats Amharic alert when job title is in Ge’ez script', async () => {
    const pool = createMockPool({
      subscriptionRow: defaultSubRow,
      jobRow: {
        ...defaultJobRow,
        title: 'የዳታ ክለርክ',
        organization: 'ሳቫና',
      },
    });

    const sendMock = vi.fn<(req: SendSmsRequest) => Promise<SendSmsResult>>().mockResolvedValue({
      ok: true,
      messageId: 'afro_msg_am_01',
      status: 'queued',
      providerStatus: 'Send in progress...',
      recipient: '+251911000001',
      encoding: 'UCS-2',
      segments: 2,
    });

    const smsAdapter: SmsAdapter = {
      providerName: 'AfroMessage',
      send: sendMock,
      checkStatus: vi.fn(),
    };

    const notifier = new SmsJobAlertNotifier({ pool, smsAdapter });
    const result = await notifier.dispatch(createIntent());

    expect(result.status).toBe('delivered');
    const sentMessage = sendMock.mock.calls[0]?.[0]?.message;
    expect(sentMessage).toContain('አዲስ የስራ እድል፡ የዳታ ክለርክ በሳቫና።');
    expect(sentMessage).toContain('ማቆም');
    expect(sentMessage).toContain('https://digitalbridge.et/jobs/job-va-01');
  });

  it('marks intent complete when provider reports permanent rejection', async () => {
    const pool = createMockPool({
      subscriptionRow: defaultSubRow,
      jobRow: defaultJobRow,
    });

    const sendMock = vi.fn<(req: SendSmsRequest) => Promise<SendSmsResult>>().mockResolvedValue({
      ok: false,
      permanent: true,
      status: 'rejected',
      error: 'Unverified sender name',
    });

    const smsAdapter: SmsAdapter = {
      providerName: 'AfroMessage',
      send: sendMock,
      checkStatus: vi.fn(),
    };

    const notifier = new SmsJobAlertNotifier({ pool, smsAdapter });
    const intent = createIntent();

    const result = await notifier.dispatch(intent);
    expect(result).toEqual({ status: 'suppressed', reason: 'Unverified sender name' });
    expect(await notifier.processClaimedIntent(intent)).toBe('complete');
  });

  it('releases intent for retry when transient network error occurs within retry budget', async () => {
    const pool = createMockPool({
      subscriptionRow: defaultSubRow,
      jobRow: defaultJobRow,
    });

    const sendMock = vi.fn<(req: SendSmsRequest) => Promise<SendSmsResult>>().mockResolvedValue({
      ok: false,
      permanent: false,
      status: 'unknown',
      error: 'AfroMessage dispatch timed out',
    });

    const smsAdapter: SmsAdapter = {
      providerName: 'AfroMessage',
      send: sendMock,
      checkStatus: vi.fn(),
    };

    const notifier = new SmsJobAlertNotifier({ pool, smsAdapter, maxAttempts: 3 });
    const intent = createIntent({ attemptCount: 1 });

    const result = await notifier.dispatch(intent);
    expect(result).toEqual({
      status: 'released',
      reason: 'AfroMessage dispatch timed out',
      attemptCount: 1,
    });
    expect(await notifier.processClaimedIntent(intent)).toBe('release');
  });

  it('exhausts retry attempts when attemptCount reaches maxAttempts', async () => {
    const pool = createMockPool({
      subscriptionRow: defaultSubRow,
      jobRow: defaultJobRow,
    });

    const sendMock = vi.fn<(req: SendSmsRequest) => Promise<SendSmsResult>>().mockResolvedValue({
      ok: false,
      permanent: false,
      status: 'unknown',
      error: 'Gateway HTTP 500',
    });

    const smsAdapter: SmsAdapter = {
      providerName: 'AfroMessage',
      send: sendMock,
      checkStatus: vi.fn(),
    };

    const notifier = new SmsJobAlertNotifier({ pool, smsAdapter, maxAttempts: 3 });
    const intent = createIntent({ attemptCount: 3 });

    const result = await notifier.dispatch(intent);
    expect(result).toEqual({
      status: 'exhausted',
      reason: 'Gateway HTTP 500',
      attemptCount: 3,
    });
    // Worker completes exhausted intent to prevent infinite loops
    expect(await notifier.processClaimedIntent(intent)).toBe('complete');
  });
});
