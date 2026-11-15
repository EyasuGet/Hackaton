// HTTP routes for Telegram linking, status, revocation, and incoming webhooks (T3-012-A).
// Web routes are protected by bearer authentication and learner role checks.
// Webhook route is protected by optional X-Telegram-Bot-Api-Secret-Token header validation.
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler,
} from 'fastify';
import { principalOf, requireRole } from '../../../../identity/presentation/http/authentication.ts';
import type { TelegramIdentityService } from '../../application/telegram-identity-service.ts';
import type { TelegramUpdate } from '../../domain/telegram-identity.ts';

export interface TelegramRoutesOptions {
  readonly webhookSecret?: string | undefined;
}

export function registerTelegramRoutes(
  app: FastifyInstance,
  authenticate: preHandlerAsyncHookHandler,
  service: TelegramIdentityService,
  options: TelegramRoutesOptions = {},
) {
  const learnerOnly = [authenticate, requireRole('learner')];

  // Learner generates a short-lived single-use linking token from the web assistant.
  app.post(
    '/api/channels/telegram/link-token',
    { preHandler: learnerOnly },
    async (request, reply) => {
      const principal = principalOf(request);
      const tokenResult = await service.createLinkingToken(principal.id);
      return reply.code(201).send(tokenResult);
    },
  );

  // Learner inspects whether their account currently has an active Telegram identity link.
  app.get('/api/channels/telegram/status', { preHandler: learnerOnly }, async (request, reply) => {
    const principal = principalOf(request);
    const status = await service.getIdentityStatus(principal.id);
    return reply.send(status);
  });

  // Learner revokes the Telegram identity link at any time from the web assistant.
  // Both DELETE and POST /revoke are supported for REST convenience.
  const handleRevoke = async (request: FastifyRequest, reply: FastifyReply) => {
    const principal = principalOf(request);
    const result = await service.revokeIdentity(principal.id);
    return reply.send(result);
  };

  app.post('/api/channels/telegram/revoke', { preHandler: learnerOnly }, handleRevoke);
  app.delete('/api/channels/telegram/link', { preHandler: learnerOnly }, handleRevoke);

  // Inbound Telegram webhook endpoint.
  // Validates incoming update authenticity and secret token header when configured.
  app.post('/api/channels/telegram/webhook', async (request, reply) => {
    const secretHeader = request.headers['x-telegram-bot-api-secret-token'] as string | undefined;
    const outcome = await service.handleTelegramUpdate(
      request.body as TelegramUpdate,
      secretHeader,
      options.webhookSecret,
    );

    if (!outcome.handled && outcome.error === 'unauthorized') {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    if (!outcome.handled && outcome.error === 'invalid_payload') {
      return reply.code(400).send({ error: 'invalid_payload' });
    }

    return reply.send(outcome);
  });
}
