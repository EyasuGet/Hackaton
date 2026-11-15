// Unit and integration tests for SMS course question answering (T3-040)
// and one-tap human help escalation over SMS (T3-041).
// Proves:
// 1. Unverified numbers receive instructional SMS directing to web account.
// 2. Verified numbers answer course questions in FAQ mode only with short citation code [breaks].
// 3. Segment budgeting (160 GSM-7 / 70 UCS-2) and MORE / ተጨማሪ pagination.
// 4. Human help escalation with HELP / እርዳታ submitting to Help queue.
// 5. STOP / ማቆም opt-out suppression.
// 6. Per-phone sliding window rate limiting.
// 7. Unsupported questions return honest limitations without external AI search.
// 8. HTTP endpoints POST /api/delivery/sms/inbound handle AfroMessage payload.

import { describe, expect, it, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { ResolvePrincipal } from '../identity/application/resolve-principal.ts';
import type { PhoneVerificationRepository } from './application/ports/phone-verification-repository.ts';
import type { PhoneVerificationCode } from './domain/phone-verification.ts';
import type { SmsAdapter } from './application/ports/sms-adapter.ts';
import type { SendSmsRequest, SendSmsResult, SmsStatusResult } from './domain/sms-contract.ts';
import { SmsTutorService } from './application/sms-tutor-service.ts';
import { InMemorySmsSuppressionRegistry } from './infrastructure/afromessage-sms-adapter.ts';
import { registerSmsSubscriptionRoutes } from './presentation/http/sms-subscription-routes.ts';
import { SlidingWindowRateLimiter } from '../telegram/application/rate-limiter.ts';
import { Tutoring } from '../tutoring/application/tutoring.ts';
import type {
  TutoringRepository,
  ClaimRequestInput,
  ClaimResult as TutorClaimResult,
  RecordOutcomeInput,
} from '../tutoring/application/ports/tutoring-repository.ts';
import type { TutoringConversation } from '../tutoring/domain/conversation.ts';
import type { TutoringRequest } from '../tutoring/domain/tutoring-request.ts';
import { FaqProvider } from '../tutoring/application/faq-provider.ts';
import { ContentAccess } from '../content/application/content-access.ts';
import type { CitationResult, CitedSection } from '../content/domain/retrieval.ts';
import { Help } from '../help/application/help.ts';
import type {
  HelpRepository,
  SubmitResult,
  SubmitHelpInput,
  QueueItem,
  ClaimResult,
  AddReplyResult,
} from '../help/application/ports/help-repository.ts';
import type { HelpRequest, HelpReply } from '../help/domain/help-request.ts';
import type { OwnedScope, Principal } from '../identity/domain/principal.ts';

// Mock SmsAdapter capturing all sent messages
class MockSmsAdapter implements SmsAdapter {
  readonly providerName = 'mock-sms';
  readonly sent: SendSmsRequest[] = [];

  send(request: SendSmsRequest): Promise<SendSmsResult> {
    this.sent.push(request);
    return Promise.resolve({
      ok: true,
      status: 'delivered',
      messageId: `msg-${this.sent.length}`,
      recipient: request.to,
      providerStatus: 'DELIVRD',
      segments: 1,
      encoding: 'GSM-7',
      characterCount: request.message.length,
      estimatedCostEtb: 0.35,
    });
  }

  checkStatus(messageId: string): Promise<SmsStatusResult> {
    return Promise.resolve({
      messageId,
      status: 'delivered',
      providerStatus: 'DELIVRD',
      isTerminal: true,
    });
  }
}

// In-memory PhoneVerificationRepository
class MockPhoneVerificationRepository implements PhoneVerificationRepository {
  readonly verifiedPhones = new Map<string, string>(); // phone -> learnerId
  readonly principals = new Map<string, Principal>(); // phone -> principal

  findLatestByPhoneNumber(): Promise<PhoneVerificationCode | null> {
    return Promise.resolve(null);
  }
  findActiveByLearnerAndPhone(): Promise<PhoneVerificationCode | null> {
    return Promise.resolve(null);
  }
  save(): Promise<void> {
    return Promise.resolve();
  }
  isPhoneVerifiedForLearner(learnerId: string, phoneNumber: string): Promise<boolean> {
    return Promise.resolve(this.verifiedPhones.get(phoneNumber) === learnerId);
  }
  markPhoneVerified(learnerId: string, phoneNumber: string): Promise<void> {
    this.verifiedPhones.set(phoneNumber, learnerId);
    return Promise.resolve();
  }
  isPhoneVerified(phoneNumber: string): Promise<boolean> {
    return Promise.resolve(this.verifiedPhones.has(phoneNumber));
  }
  findLearnerByPhoneNumber(phoneNumber: string): Promise<string | null> {
    return Promise.resolve(this.verifiedPhones.get(phoneNumber) ?? null);
  }
  findPrincipalByPhoneNumber(phoneNumber: string): Promise<Principal | null> {
    const existing = this.principals.get(phoneNumber);
    if (existing) return Promise.resolve(existing);
    const learnerId = this.verifiedPhones.get(phoneNumber);
    if (learnerId) {
      return Promise.resolve({
        id: learnerId,
        role: 'learner',
        label: 'SMS Learner',
        demo: false,
        courseIds: ['course-1', 'course-2'],
      });
    }
    return Promise.resolve(null);
  }
}

// In-memory HelpRepository
class MockHelpRepository implements HelpRepository {
  readonly requests = new Map<string, HelpRequest>();
  readonly preferences = new Map<string, boolean>();
  #counter = 1;

  submit(scope: OwnedScope, input: SubmitHelpInput): Promise<SubmitResult> {
    const now = new Date().toISOString();
    const req: HelpRequest = {
      id: `help-req-${this.#counter++}`,
      ownerId: scope.ownerId,
      clientRequestId: input.clientRequestId,
      contextSnapshot: input.contextSnapshot,
      consentGiven: true,
      state: 'waiting',
      createdAt: now,
      expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      updatedAt: now,
      cancelledAt: null,
      claimedBy: null,
      claimedAt: null,
      resolvedAt: null,
      resolvedBy: null,
    };
    this.requests.set(req.id, req);
    return Promise.resolve({ kind: 'submitted', request: req });
  }

  cancel(): Promise<HelpRequest | null> {
    return Promise.resolve(null);
  }
  findById(): Promise<HelpRequest | null> {
    return Promise.resolve(null);
  }
  findByIdAsStaff(): Promise<HelpRequest | null> {
    return Promise.resolve(null);
  }
  listOwned(): Promise<readonly HelpRequest[]> {
    return Promise.resolve([]);
  }
  listQueue(): Promise<readonly QueueItem[]> {
    return Promise.resolve([]);
  }
  claimRequest(): Promise<ClaimResult | null> {
    return Promise.resolve(null);
  }
  resolveRequest(): Promise<HelpRequest | null> {
    return Promise.resolve(null);
  }
  addReply(): Promise<AddReplyResult | null> {
    return Promise.resolve(null);
  }
  listReplies(): Promise<readonly HelpReply[]> {
    return Promise.resolve([]);
  }
  markRepliesRead(): Promise<void> {
    return Promise.resolve();
  }
  getNotificationPreference(scope: OwnedScope, channel: string): Promise<boolean> {
    return Promise.resolve(this.preferences.get(`${scope.ownerId}:${channel}`) ?? false);
  }
  setNotificationPreference(
    scope: OwnedScope,
    channel: string,
    optedIn: boolean,
  ): Promise<boolean> {
    this.preferences.set(`${scope.ownerId}:${channel}`, optedIn);
    return Promise.resolve(true);
  }
  optIn(scope: OwnedScope, channel: string): Promise<void> {
    this.preferences.set(`${scope.ownerId}:${channel}`, true);
    return Promise.resolve();
  }
  optOut(scope: OwnedScope, channel: string): Promise<void> {
    this.preferences.set(`${scope.ownerId}:${channel}`, false);
    return Promise.resolve();
  }
  cancelPendingIntentsForHelpRequest(): Promise<number> {
    return Promise.resolve(0);
  }
  cancelPendingIntentsForLearner(): Promise<number> {
    return Promise.resolve(0);
  }
}

// In-memory TutoringRepository conforming to complete port interface
class TestTutoringRepository implements TutoringRepository {
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
    if (!conv || conv.ownerId !== scope.ownerId || !scope.courseIds.includes(conv.courseId)) {
      return Promise.resolve(null);
    }
    return Promise.resolve(conv);
  }

  async claimRequest(
    scope: OwnedScope,
    input: ClaimRequestInput,
  ): Promise<TutorClaimResult | null> {
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
    }

    const now = new Date();
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
      expiresAt: new Date(now.getTime() + 7 * 86400000).toISOString(),
      purgedAt: null,
    };
    this.requests.push(req);
    return { kind: 'claimed', request: req };
  }

  findRequestById(scope: OwnedScope, id: string): Promise<TutoringRequest | null> {
    const req = this.requests.find((r) => r.id === id);
    if (!req || req.ownerId !== scope.ownerId || !scope.courseIds.includes(req.courseId)) {
      return Promise.resolve(null);
    }
    return Promise.resolve(req);
  }

  findRequestByRequestId(scope: OwnedScope, requestId: string): Promise<TutoringRequest | null> {
    const req = this.requests.find((r) => r.requestId === requestId);
    if (!req || req.ownerId !== scope.ownerId || !scope.courseIds.includes(req.courseId)) {
      return Promise.resolve(null);
    }
    return Promise.resolve(req);
  }

  listHistory(scope: OwnedScope, courseId?: string): Promise<readonly TutoringRequest[]> {
    return Promise.resolve(
      this.requests.filter(
        (r) => r.ownerId === scope.ownerId && (!courseId || r.courseId === courseId),
      ),
    );
  }

  recordOutcome(
    scope: OwnedScope,
    requestId: string,
    outcome: RecordOutcomeInput,
  ): Promise<TutoringRequest | null> {
    const req = this.requests.find((r) => r.id === requestId);
    if (!req || req.ownerId !== scope.ownerId || !scope.courseIds.includes(req.courseId)) {
      return Promise.resolve(null);
    }
    const updated: TutoringRequest = {
      ...req,
      state: outcome.state,
      answerText: outcome.answerText ?? req.answerText,
      answerLang: outcome.answerLang ?? req.answerLang,
      errorReason: outcome.errorReason ?? req.errorReason,
      completedAt: outcome.state === 'completed' ? new Date().toISOString() : req.completedAt,
      updatedAt: new Date().toISOString(),
    };
    const index = this.requests.indexOf(req);
    this.requests[index] = updated;
    return Promise.resolve(updated);
  }

  clearHistory(scope: OwnedScope): Promise<void> {
    for (let i = this.requests.length - 1; i >= 0; i--) {
      if (this.requests[i]?.ownerId === scope.ownerId) {
        this.requests.splice(i, 1);
      }
    }
    return Promise.resolve();
  }

  purgeExpired(): Promise<number> {
    return Promise.resolve(0);
  }
}

function createTestContentAccess(): ContentAccess {
  return new ContentAccess(
    {
      search: () => Promise.resolve([]),
      resolve: (courseIds, sourceId, sectionId): Promise<CitationResult> => {
        if (sourceId === 'savanna-va1-future-of-va-industry' && courseIds.includes('course-1')) {
          const sec: CitedSection = {
            sourceId,
            sectionId,
            sourceTitle: 'The Future of the VA Industry',
            heading:
              sectionId === 'introduction'
                ? 'Introduction'
                : 'Artificial Intelligence and the Future of VA Work',
            text: 'In some reports, a "virtual assistant" refers to AI software assistants.',
            language: 'en',
            courseId: 'course-1',
            version: 'starter-9e83ac7',
            anchor: sectionId,
            provenance: {
              kind: 'organiser',
              repository: 'alx-africa/Savanna-static-pages',
              commit: '9e83ac7',
              path: 'pages/concept-with-navigation.html',
            },
          };
          return Promise.resolve({ kind: 'section', section: sec });
        }
        if (sourceId === 'demo-time-management-am' && courseIds.includes('course-2')) {
          const sec: CitedSection = {
            sourceId,
            sectionId,
            sourceTitle: 'የጊዜ አጠቃቀም መሠረታዊ ነገሮች',
            heading: sectionId === 'planning' ? 'እቅድ ማውጣት' : 'እረፍት መውሰድ',
            text:
              sectionId === 'breaks'
                ? 'በሥራ መካከል አጭር እረፍት መውሰድ ትኩረትን ለመጠበቅ ይረዳል።'
                : 'ቀኑን ከመጀመርዎ በፊት የሚሠሯቸውን ሥራዎች ይዘርዝሩ።',
            language: 'am',
            courseId: 'course-2',
            version: 'demo-1',
            anchor: null,
            provenance: { kind: 'demo', note: 'test' },
          };
          return Promise.resolve({ kind: 'section', section: sec });
        }
        return Promise.resolve({ kind: 'not_found' });
      },
    },
    [],
  );
}

describe('SmsTutorService (T3-040, T3-041)', () => {
  let phoneRepo: MockPhoneVerificationRepository;
  let smsAdapter: MockSmsAdapter;
  let suppressionRegistry: InMemorySmsSuppressionRegistry;
  let helpRepo: MockHelpRepository;
  let help: Help;
  let tutoring: Tutoring;
  let rateLimiter: SlidingWindowRateLimiter;
  let service: SmsTutorService;
  let clock: Date;

  const verifiedPhone = '+251911223344';
  const unverifiedPhone = '+251922334455';
  const learnerPrincipal: Principal = {
    id: 'learner-001',
    role: 'learner',
    label: 'Learner One',
    demo: false,
    courseIds: ['course-1', 'course-2'],
  };

  beforeEach(() => {
    clock = new Date('2026-11-15T12:00:00Z');
    phoneRepo = new MockPhoneVerificationRepository();
    smsAdapter = new MockSmsAdapter();
    suppressionRegistry = new InMemorySmsSuppressionRegistry();
    helpRepo = new MockHelpRepository();
    help = new Help(helpRepo);

    // Register verified phone
    phoneRepo.verifiedPhones.set(verifiedPhone, learnerPrincipal.id);
    phoneRepo.principals.set(verifiedPhone, learnerPrincipal);

    // Wire Content & Tutoring
    const content = createTestContentAccess();
    const faq = new FaqProvider(content);
    const tutoringRepo = new TestTutoringRepository();
    tutoring = new Tutoring(tutoringRepo, faq, undefined, content);

    rateLimiter = new SlidingWindowRateLimiter(5, 60_000, () => clock);

    service = new SmsTutorService({
      phoneVerificationRepository: phoneRepo,
      tutoring,
      smsAdapter,
      help,
      rateLimiter,
      suppressionRegistry,
      maxSegmentsPerReply: 1,
      defaultCourseId: 'course-1',
      now: () => clock,
    });
  });

  it('unverified phone receives instructional SMS only and never invokes tutoring', async () => {
    const result = await service.handleInboundMessage({
      sender: unverifiedPhone,
      message: 'What is a virtual assistant?',
    });

    expect(result.status).toBe('unverified_instructions');
    expect(result.sender).toBe(unverifiedPhone);

    expect(smsAdapter.sent).toHaveLength(1);
    expect(smsAdapter.sent[0]?.to).toBe(unverifiedPhone);
    expect(smsAdapter.sent[0]?.message).toContain(
      'To ask course questions via SMS, please verify your phone',
    );
    expect(smsAdapter.sent[0]?.message).toContain('https://assistant.alxafrica.com');
  });

  it('verified phone receives complete single-segment answer ending with citation code [breaks]', async () => {
    // Principal has course-2 active for Amharic FAQ
    const amharicLearner: Principal = {
      id: 'learner-amharic',
      role: 'learner',
      label: 'Amharic Learner',
      demo: false,
      courseIds: ['course-2'],
    };
    phoneRepo.principals.set('+251911998877', amharicLearner);
    phoneRepo.verifiedPhones.set('+251911998877', amharicLearner.id);

    const result = await service.handleInboundMessage({
      sender: '+251911998877',
      message: 'በሥራ መካከል አጭር እረፍት መውሰድ ምን ጥቅም ያስገኛል',
    });

    expect(result.status).toBe('answered');
    expect(result.paginated).toBe(false);
    expect(result.answerText).toContain('በሥራ መካከል አጭር እረፍት መውሰድ ትኩረትን ለመጠበቅ ይረዳል።');
    expect(result.answerText).toContain('[breaks]');
    expect(smsAdapter.sent[0]?.message).toContain('[breaks]');
    expect(smsAdapter.sent[0]?.message).not.toContain('MORE');
  });

  it('enforces single segment budget and paginates long answers with MORE down to final citation', async () => {
    // The answer for 'What is a virtual assistant?' is 308 chars -> exceeds 1 segment (160 GSM-7)
    const res1 = await service.handleInboundMessage({
      sender: verifiedPhone,
      message: 'What is a virtual assistant?',
    });

    expect(res1.status).toBe('answered');
    expect(res1.paginated).toBe(true);
    expect(smsAdapter.sent[0]?.message).toContain('Reply MORE for next part');

    // Send MORE (chunk 2)
    const resMore1 = await service.handleInboundMessage({
      sender: verifiedPhone,
      message: 'MORE',
    });
    expect(resMore1.status).toBe('more_sent');

    // Send MORE (chunk 3 - final chunk containing citation)
    const resMore2 = await service.handleInboundMessage({
      sender: verifiedPhone,
      message: 'MORE',
    });
    expect(resMore2.status).toBe('more_sent');
    expect(resMore2.answerText).toContain('[introduction]');
    expect(resMore2.paginated).toBe(false);

    // Send MORE again when exhausted
    const resEnd = await service.handleInboundMessage({
      sender: verifiedPhone,
      message: 'MORE',
    });

    expect(resEnd.status).toBe('more_empty');
    expect(smsAdapter.sent[smsAdapter.sent.length - 1]?.message).toContain(
      'No further parts to show',
    );
  });

  it('inbound HELP keyword escalates to human support and creates owned Help request', async () => {
    const result = await service.handleInboundMessage({
      sender: verifiedPhone,
      message: 'HELP',
    });

    expect(result.status).toBe('help_submitted');
    expect(result.helpRequestId).toBeDefined();

    // Verify Help request in queue
    expect(helpRepo.requests.size).toBe(1);
    const req = Array.from(helpRepo.requests.values())[0]!;
    expect(req.ownerId).toBe(learnerPrincipal.id);
    expect(req.contextSnapshot).toContain(verifiedPhone);

    // Confirmation SMS sent
    expect(smsAdapter.sent).toHaveLength(1);
    expect(smsAdapter.sent[0]?.message).toContain('Your help request has been received');
    expect(smsAdapter.sent[0]?.message).toContain('የድጋፍ ጥያቄዎ ደርሶናል');
  });

  it('inbound Amharic እርዳታ keyword escalates to human support', async () => {
    const result = await service.handleInboundMessage({
      sender: verifiedPhone,
      message: 'እርዳታ',
    });

    expect(result.status).toBe('help_submitted');
    expect(helpRepo.requests.size).toBe(1);
  });

  it('inbound STOP keyword opts out and suppresses future messages', async () => {
    const result = await service.handleInboundMessage({
      sender: verifiedPhone,
      message: 'STOP',
    });

    expect(result.status).toBe('opt_out');

    // Number is suppressed
    const isSuppressed = suppressionRegistry.isSuppressed(verifiedPhone);
    expect(isSuppressed).toBe(true);

    // Unsubscribe acknowledgment dispatched
    expect(smsAdapter.sent).toHaveLength(1);
    expect(smsAdapter.sent[0]?.message).toContain('You have unsubscribed from Track 3 SMS');
  });

  it('inbound Amharic ማቆም keyword opts out learner', async () => {
    const result = await service.handleInboundMessage({
      sender: verifiedPhone,
      message: 'ማቆም',
    });

    expect(result.status).toBe('opt_out');
    const isSuppressed = suppressionRegistry.isSuppressed(verifiedPhone);
    expect(isSuppressed).toBe(true);
  });

  it('enforces per-phone sliding window rate limit', async () => {
    // Rate limit is 5 per 60s
    for (let i = 0; i < 5; i++) {
      const res = await service.handleInboundMessage({
        sender: verifiedPhone,
        message: 'HELP',
      });
      expect(res.status).toBe('help_submitted');
    }

    // 6th request triggers rate limit
    const blockedRes = await service.handleInboundMessage({
      sender: verifiedPhone,
      message: 'HELP',
    });

    expect(blockedRes.status).toBe('rate_limited');
    expect(blockedRes.retryAfterSec).toBeGreaterThan(0);
    expect(smsAdapter.sent[smsAdapter.sent.length - 1]?.message).toContain('Rate limit reached');
  });

  it('returns honest limitation for questions not covered in course materials', async () => {
    const result = await service.handleInboundMessage({
      sender: verifiedPhone,
      message: 'What is the speed of light?',
    });

    expect(result.status).toBe('limitation');
    expect(smsAdapter.sent).toHaveLength(1);
    expect(smsAdapter.sent[0]?.message).toContain('could not find an approved answer');
    expect(smsAdapter.sent[0]?.message).toContain('Reply HELP');
  });

  it('rejects invalid or non-Ethiopian phone numbers', async () => {
    const result = await service.handleInboundMessage({
      sender: '+14155552671', // US number
      message: 'Hello',
    });

    expect(result.status).toBe('rejected');
    expect(result.reason).toContain('Ethiopian');
  });
});

describe('SMS Subscription & Inbound HTTP Routes', () => {
  it('handles AfroMessage inbound webhook via POST /api/delivery/sms/inbound', async () => {
    const phoneRepo = new MockPhoneVerificationRepository();
    const smsAdapter = new MockSmsAdapter();
    const content = createTestContentAccess();
    const faq = new FaqProvider(content);
    const tutoringRepo = new TestTutoringRepository();
    const tutoring = new Tutoring(tutoringRepo, faq, undefined, content);

    const verifiedPhone = '+251911223344';
    phoneRepo.verifiedPhones.set(verifiedPhone, 'learner-001');

    const smsTutorService = new SmsTutorService({
      phoneVerificationRepository: phoneRepo,
      tutoring,
      smsAdapter,
      defaultCourseId: 'course-1',
    });

    const mockResolvePrincipal = {
      execute: () => Promise.resolve(null),
    } as unknown as ResolvePrincipal;

    const app = Fastify();
    registerSmsSubscriptionRoutes(app, mockResolvePrincipal, undefined, smsTutorService);

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/delivery/sms/inbound',
        payload: {
          from: '0911223344',
          to: '8080',
          message: 'What is a virtual assistant?',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ status: string; answerText: string; paginated: boolean }>();
      expect(body.status).toBe('answered');
      expect(body.paginated).toBe(true);
      expect(body.answerText).toContain('Reply MORE for next part');
    } finally {
      await app.close();
    }
  });
});
