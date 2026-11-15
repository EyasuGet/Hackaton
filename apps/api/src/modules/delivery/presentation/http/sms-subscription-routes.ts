// HTTP presentation routes for SMS job alert subscriptions (T3-021-A).
// Implements phone ownership verification, challenge confirmation, subscription management,
// and immediate opt-out / suppression of delivery intents for authenticated learners.

import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler,
} from 'fastify';
import type { ResolvePrincipal } from '../../../identity/application/resolve-principal.ts';
import {
  authenticate,
  principalOf,
  requireRole,
} from '../../../identity/presentation/http/authentication.ts';
import type { SmsSubscriptionService } from '../../application/sms-subscription-service.ts';
import type { SmsTutorService } from '../../application/sms-tutor-service.ts';

interface RequestSmsSubscriptionBody {
  readonly phoneNumber: string;
  readonly categories?: readonly string[] | undefined;
  readonly locations?: readonly string[] | undefined;
}

interface VerifySmsSubscriptionBody {
  readonly phoneNumber: string;
  readonly code: string;
  readonly categories?: readonly string[] | undefined;
  readonly locations?: readonly string[] | undefined;
}

export function registerSmsSubscriptionRoutes(
  app: FastifyInstance,
  resolvePrincipal: ResolvePrincipal,
  smsSubscriptionService?: SmsSubscriptionService,
  smsTutorService?: SmsTutorService,
): void {
  const learnerOnly: preHandlerAsyncHookHandler[] = [
    authenticate(resolvePrincipal),
    requireRole('learner'),
  ];

  if (smsSubscriptionService) {
    const service = smsSubscriptionService;

    const handleRequestSubscription = async (
      request: FastifyRequest<{ Body: RequestSmsSubscriptionBody }>,
      reply: FastifyReply,
    ) => {
      const { phoneNumber, categories, locations } = request.body ?? {};
      if (!phoneNumber || typeof phoneNumber !== 'string') {
        return reply.code(400).send({
          error: 'invalid_phone',
          message: 'Phone number is required and must be an Ethiopian mobile number (+251...)',
        });
      }

      const principal = principalOf(request);
      const outcome = await service.requestSubscription(principal, {
        phoneNumber: phoneNumber.trim(),
        categories: Array.isArray(categories) ? categories : [],
        locations: Array.isArray(locations) ? locations : [],
      });

      if (!outcome.ok) {
        const statusCode = outcome.reason === 'cooldown_active' ? 429 : 400;
        return reply.code(statusCode).send({
          error: outcome.reason,
          message: outcome.error,
          ...(outcome.retryAfterSeconds !== undefined
            ? { retryAfterSeconds: outcome.retryAfterSeconds }
            : {}),
        });
      }

      if (outcome.status === 'active') {
        return reply.code(201).send({
          status: 'active',
          subscription: outcome.subscription,
          maskedPhone: outcome.maskedPhone,
        });
      }

      return reply.code(200).send({
        status: 'verification_required',
        challengeId: outcome.challengeId,
        maskedPhone: outcome.maskedPhone,
        expiresAt: outcome.expiresAt.toISOString(),
        cooldownSeconds: outcome.cooldownSeconds,
        dispatchStatus: outcome.dispatchStatus,
      });
    };

    const handleVerifySubscription = async (
      request: FastifyRequest<{ Body: VerifySmsSubscriptionBody }>,
      reply: FastifyReply,
    ) => {
      const { phoneNumber, code, categories, locations } = request.body ?? {};
      if (!phoneNumber || typeof phoneNumber !== 'string' || !code || typeof code !== 'string') {
        return reply.code(400).send({
          error: 'invalid_input',
          message: 'phoneNumber and verification code are required',
        });
      }

      const principal = principalOf(request);
      const outcome = await service.verifyAndSubscribe(principal, {
        phoneNumber: phoneNumber.trim(),
        code: code.trim(),
        categories: Array.isArray(categories) ? categories : [],
        locations: Array.isArray(locations) ? locations : [],
      });

      if (!outcome.ok) {
        const statusCode = outcome.status === 'exhausted' ? 429 : 400;
        return reply.code(statusCode).send({
          error: outcome.status,
          message: outcome.reason,
          remainingAttempts: outcome.remainingAttempts,
        });
      }

      return reply.code(201).send({
        status: 'active',
        subscription: outcome.subscription,
        maskedPhone: outcome.maskedPhone,
        verifiedAt: outcome.verifiedAt.toISOString(),
      });
    };

    const handleGetStatus = async (request: FastifyRequest, reply: FastifyReply) => {
      const principal = principalOf(request);
      const status = await service.getStatus(principal);
      return reply.code(200).send(status);
    };

    const handleUnsubscribe = async (request: FastifyRequest, reply: FastifyReply) => {
      const principal = principalOf(request);
      const params = request.params as { readonly id?: string | undefined } | undefined;
      const subscriptionId = params?.id;
      const outcome = await service.unsubscribe(principal, subscriptionId);

      if (!outcome) {
        return reply.code(404).send({ error: 'subscription_not_found' });
      }

      return reply.code(200).send({
        status: 'unsubscribed',
        cancelledIntentsCount: outcome.cancelledIntentsCount,
        contactRemoved: outcome.contactRemoved,
        ...(outcome.subscription ? { subscription: outcome.subscription } : {}),
      });
    };

    // Primary routes under /api/delivery/sms/subscriptions
    app.post<{ Body: RequestSmsSubscriptionBody }>(
      '/api/delivery/sms/subscriptions/request',
      { preHandler: learnerOnly },
      handleRequestSubscription,
    );
    app.post<{ Body: VerifySmsSubscriptionBody }>(
      '/api/delivery/sms/subscriptions/verify',
      { preHandler: learnerOnly },
      handleVerifySubscription,
    );
    app.get('/api/delivery/sms/subscriptions/status', { preHandler: learnerOnly }, handleGetStatus);
    app.delete('/api/delivery/sms/subscriptions', { preHandler: learnerOnly }, handleUnsubscribe);
    app.delete(
      '/api/delivery/sms/subscriptions/:id',
      { preHandler: learnerOnly },
      handleUnsubscribe,
    );

    // Aliases under /api/careers/sms-subscriptions for developer and client flexibility
    app.post<{ Body: RequestSmsSubscriptionBody }>(
      '/api/careers/sms-subscriptions/request',
      { preHandler: learnerOnly },
      handleRequestSubscription,
    );
    app.post<{ Body: VerifySmsSubscriptionBody }>(
      '/api/careers/sms-subscriptions/verify',
      { preHandler: learnerOnly },
      handleVerifySubscription,
    );
    app.get('/api/careers/sms-subscriptions/status', { preHandler: learnerOnly }, handleGetStatus);
    app.delete('/api/careers/sms-subscriptions', { preHandler: learnerOnly }, handleUnsubscribe);
    app.delete(
      '/api/careers/sms-subscriptions/:id',
      { preHandler: learnerOnly },
      handleUnsubscribe,
    );
  }

  if (smsTutorService) {
    app.post('/api/delivery/sms/inbound', async (request, reply) => {
      const outcome = await smsTutorService.handleInboundMessage(request.body);
      return reply.code(200).send(outcome);
    });
    app.post('/api/delivery/sms/webhook', async (request, reply) => {
      const outcome = await smsTutorService.handleInboundMessage(request.body);
      return reply.code(200).send(outcome);
    });
  }
}
