// HTTP presentation routes for Telegram identity linking and webhook updates (T3-012-A).
// Implements secure single-use link code issuance, status queries, revocation,
// direct linking, and incoming update handling with secret verification.
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
import type { TelegramLinkService } from '../../application/telegram-link-service.ts';
import type { TelegramChatType, TelegramUpdate } from '../../domain/telegram-identity.ts';

interface DirectLinkBody {
  readonly code: string;
  readonly telegramUserId: string;
  readonly telegramChatId: string;
  readonly chatType: string;
  readonly telegramUsername?: string;
}

interface WebhookUpdatePayload {
  readonly update_id: number;
  readonly message?: {
    readonly message_id: number;
    readonly from?: {
      readonly id: number | string;
      readonly is_bot?: boolean;
      readonly first_name?: string;
      readonly last_name?: string;
      readonly username?: string;
    };
    readonly chat: {
      readonly id: number | string;
      readonly type: string;
      readonly title?: string;
      readonly username?: string;
    };
    readonly date: number;
    readonly text?: string;
  };
  readonly callback_query?: {
    readonly id: string;
    readonly from: {
      readonly id: number | string;
      readonly is_bot?: boolean;
      readonly first_name?: string;
      readonly last_name?: string;
      readonly username?: string;
    };
    readonly message?: {
      readonly message_id: number;
      readonly chat: {
        readonly id: number | string;
        readonly type: string;
      };
      readonly date: number;
      readonly text?: string;
    };
    readonly data?: string;
  };
}

export function registerTelegramRoutes(
  app: FastifyInstance,
  resolvePrincipal: ResolvePrincipal,
  telegramService: TelegramLinkService,
): void {
  const learnerOnly: preHandlerAsyncHookHandler[] = [
    authenticate(resolvePrincipal),
    requireRole('learner'),
  ];

  // 1. Authenticated learner issues a single-use expiring link code
  app.post(
    '/api/telegram/link-code',
    { preHandler: learnerOnly },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const principal = principalOf(request);
      const issued = await telegramService.issueLinkCode(principal);
      return reply.code(201).send({
        code: issued.code,
        expiresAt: issued.expiresAt.toISOString(),
      });
    },
  );

  // 2. Authenticated learner inspects current linking status
  app.get(
    '/api/telegram/status',
    { preHandler: learnerOnly },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const principal = principalOf(request);
      const status = await telegramService.getStatus(principal);
      return reply.code(200).send(status);
    },
  );

  // 3. Authenticated learner revokes their linked Telegram identity
  app.delete(
    '/api/telegram/link',
    { preHandler: learnerOnly },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const principal = principalOf(request);
      const unlinked = await telegramService.unlinkByLearner(principal);
      if (!unlinked) {
        return reply.code(404).send({ error: 'not_linked' });
      }
      return reply.code(204).send();
    },
  );

  // 4. Direct account linking API (for web-assisted linking or test flows)
  app.post<{ Body: DirectLinkBody }>(
    '/api/telegram/link',
    {
      schema: {
        body: {
          type: 'object',
          required: ['code', 'telegramUserId', 'telegramChatId', 'chatType'],
          additionalProperties: false,
          properties: {
            code: { type: 'string', minLength: 20, maxLength: 128 },
            telegramUserId: { type: 'string', minLength: 1, maxLength: 64 },
            telegramChatId: { type: 'string', minLength: 1, maxLength: 64 },
            chatType: { type: 'string', minLength: 1, maxLength: 32 },
            telegramUsername: { type: 'string', minLength: 1, maxLength: 64 },
          },
        },
      },
    },
    async (request, reply) => {
      const { code, telegramUserId, telegramChatId, chatType, telegramUsername } = request.body;

      if (chatType !== 'private') {
        return reply.code(400).send({
          error: 'group_chats_not_allowed',
          message: 'Group chats never establish learner access. Only private chats are permitted.',
        });
      }

      const result = await telegramService.linkAccount({
        code,
        telegramUserId,
        telegramChatId,
        chatType,
        telegramUsername,
      });

      if (!result.success) {
        const status =
          result.reason === 'telegram_user_already_linked' ||
          result.reason === 'learner_already_linked'
            ? 409
            : 400;
        return reply.code(status).send({ error: result.reason });
      }

      return reply.code(201).send({
        success: true,
        identity: {
          id: result.identity.id,
          learnerId: result.identity.learnerId,
          telegramUserId: result.identity.telegramUserId,
          linkedAt: result.identity.linkedAt.toISOString(),
        },
      });
    },
  );

  // 5. Inbound Telegram Webhook update handler
  app.post<{ Body: WebhookUpdatePayload }>(
    '/api/telegram/webhook',
    async (request: FastifyRequest<{ Body: WebhookUpdatePayload }>, reply: FastifyReply) => {
      const secretHeader = request.headers['x-telegram-bot-api-secret-token'];
      const secretToken = Array.isArray(secretHeader) ? secretHeader[0] : secretHeader;

      const payload = request.body;
      const update: TelegramUpdate = {
        updateId: payload?.update_id ?? 0,
        message: payload?.message
          ? {
              messageId: payload.message.message_id,
              from: payload.message.from
                ? {
                    id: String(payload.message.from.id),
                    isBot: Boolean(payload.message.from.is_bot),
                    firstName: payload.message.from.first_name,
                    lastName: payload.message.from.last_name,
                    username: payload.message.from.username,
                  }
                : undefined,
              chat: {
                id: String(payload.message.chat.id),
                type: (payload.message.chat.type as TelegramChatType) || 'private',
                title: payload.message.chat.title,
                username: payload.message.chat.username,
              },
              date: payload.message.date,
              text: payload.message.text,
            }
          : undefined,
        callbackQuery: payload?.callback_query
          ? {
              id: payload.callback_query.id,
              from: {
                id: String(payload.callback_query.from.id),
                isBot: Boolean(payload.callback_query.from.is_bot),
                firstName: payload.callback_query.from.first_name,
                lastName: payload.callback_query.from.last_name,
                username: payload.callback_query.from.username,
              },
              message: payload.callback_query.message
                ? {
                    messageId: payload.callback_query.message.message_id,
                    chat: {
                      id: String(payload.callback_query.message.chat.id),
                      type:
                        (payload.callback_query.message.chat.type as TelegramChatType) || 'private',
                    },
                    date: payload.callback_query.message.date,
                    text: payload.callback_query.message.text,
                  }
                : undefined,
              data: payload.callback_query.data,
            }
          : undefined,
      };

      const result = await telegramService.handleWebhookUpdate(update, secretToken);

      if (result.status === 'unauthorized') {
        return reply.code(401).send({ error: 'unauthorized' });
      }

      if (result.status === 'rejected') {
        return reply.code(400).send({ error: result.reason });
      }

      if (result.status === 'link_failed') {
        const code =
          result.reason === 'telegram_user_already_linked' ||
          result.reason === 'learner_already_linked'
            ? 409
            : 400;
        return reply.code(code).send({ error: result.reason });
      }

      return reply.code(200).send({ ok: true, status: result.status });
    },
  );
}
