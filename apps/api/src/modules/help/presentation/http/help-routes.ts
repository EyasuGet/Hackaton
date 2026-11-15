// HTTP presentation routes for learner and staff help requests. Only
// authenticated learners may submit or cancel their own requests; only support
// staff may access the queue and claim endpoints.
import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import { principalOf, requireRole } from '../../../identity/presentation/http/authentication.ts';
import type { Help } from '../../application/help.ts';
import {
  isScreenshotMimeType,
  SCREENSHOT_MAX_BYTES,
  type HelpScreenshots,
} from '../../application/help-screenshots.ts';
import type { StaffHelp } from '../../application/staff-help.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SubmitBody {
  clientRequestId: string;
  contextSnapshot: string;
}

interface ReplyBody {
  clientReplyId: string;
  body: string;
}

export function registerHelpRoutes(
  app: FastifyInstance,
  authenticated: preHandlerAsyncHookHandler,
  help: Help,
  staffHelp: StaffHelp,
  screenshots?: HelpScreenshots,
) {
  const learnerOnly = { preHandler: [authenticated, requireRole('learner')] };
  const supportOnly = { preHandler: [authenticated, requireRole('support')] };
  const authenticated_ = { preHandler: [authenticated] };

  // Submits a help request. Returns 201 on new submission, 200 on duplicate.
  app.post<{ Body: SubmitBody }>('/api/help/requests', learnerOnly, async (request, reply) => {
    const { clientRequestId, contextSnapshot } = request.body ?? {};

    if (!clientRequestId || typeof clientRequestId !== 'string' || clientRequestId.trim() === '') {
      return reply.code(400).send({ error: 'invalid_client_request_id' });
    }
    if (!contextSnapshot || typeof contextSnapshot !== 'string' || contextSnapshot.trim() === '') {
      return reply.code(400).send({ error: 'invalid_context_snapshot' });
    }

    const principal = principalOf(request);
    const result = await help.submit(principal, {
      clientRequestId: clientRequestId.trim(),
      contextSnapshot: contextSnapshot.trim(),
    });

    if (!result) {
      return reply.code(404).send({ error: 'not_found' });
    }

    const statusCode = result.kind === 'submitted' ? 201 : 200;
    return reply.code(statusCode).send({ kind: result.kind, request: result.request });
  });

  // Cancels an owned waiting help request. Returns 404 when not found, already
  // cancelled, or expired.
  app.delete<{ Params: { id: string } }>(
    '/api/help/requests/:id',
    learnerOnly,
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID.test(id)) return reply.code(404).send({ error: 'not_found' });

      const principal = principalOf(request);
      const cancelled = await help.cancel(principal, id);
      if (!cancelled) return reply.code(404).send({ error: 'not_found' });
      return reply.code(200).send({ request: cancelled });
    },
  );

  // Gets a single owned help request by id.
  app.get<{ Params: { id: string } }>(
    '/api/help/requests/:id',
    learnerOnly,
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID.test(id)) return reply.code(404).send({ error: 'not_found' });

      const principal = principalOf(request);
      const record = await help.getById(principal, id);
      return record ?? reply.code(404).send({ error: 'not_found' });
    },
  );

  // Lists non-expired help requests for the authenticated learner.
  app.get('/api/help/requests', learnerOnly, async (request) => {
    const principal = principalOf(request);
    const requests = await help.listOwned(principal);
    return { requests };
  });

  // Returns all non-expired waiting requests (queue metadata, no context snapshots).
  // Staff-only: 403 for learners.
  app.get('/api/help/queue', supportOnly, async (request, reply) => {
    const principal = principalOf(request);
    const queue = await staffHelp.listQueue(principal);
    if (!queue) return reply.code(403).send({ error: 'forbidden' });
    return { queue };
  });

  // Returns non-expired requests claimed by the authenticated support principal,
  // newest first, including the learner's shared contextSnapshot.
  // Staff-only: 403 for learners.
  app.get('/api/help/assigned', supportOnly, async (request, reply) => {
    const principal = principalOf(request);
    const requests = await staffHelp.listAssigned(principal);
    if (!requests) return reply.code(403).send({ error: 'forbidden' });
    return { requests };
  });

  // Atomically claims a waiting request for the authenticated support principal.
  // Returns 200 with the full request (including contextSnapshot) on success.
  // Returns 409 when another staff member already claimed it.
  // Returns 404 when the request does not exist or is not in waiting state.
  app.post<{ Params: { id: string } }>(
    '/api/help/requests/:id/claim',
    supportOnly,
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID.test(id)) return reply.code(404).send({ error: 'not_found' });

      const principal = principalOf(request);
      const result = await staffHelp.claimRequest(principal, id);

      if (!result) return reply.code(404).send({ error: 'not_found' });
      if (result.kind === 'already_claimed') {
        return reply
          .code(409)
          .send({ error: 'already_claimed', claimedBy: result.request.claimedBy });
      }
      return reply.code(200).send({ request: result.request });
    },
  );

  // Adds a reply to a help request.
  // Learner (owner) may reply to their own waiting/claimed request.
  // Support staff may reply to any claimed request.
  // Returns 201 on new reply, 200 on duplicate (idempotent clientReplyId).
  // Returns 409 when the request is in a terminal state or expired.
  app.post<{ Params: { id: string }; Body: ReplyBody }>(
    '/api/help/requests/:id/replies',
    authenticated_,
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID.test(id)) return reply.code(404).send({ error: 'not_found' });

      const { clientReplyId, body } = request.body ?? {};
      if (!clientReplyId || typeof clientReplyId !== 'string' || clientReplyId.trim() === '') {
        return reply.code(400).send({ error: 'invalid_client_reply_id' });
      }
      if (!body || typeof body !== 'string' || body.trim() === '') {
        return reply.code(400).send({ error: 'invalid_body' });
      }

      const principal = principalOf(request);
      let result;

      if (principal.role === 'learner') {
        result = await help.addReply(principal, id, clientReplyId.trim(), body);
      } else if (principal.role === 'support') {
        result = await staffHelp.addReply(principal, id, clientReplyId.trim(), body);
      } else {
        return reply.code(403).send({ error: 'forbidden' });
      }

      if (!result) return reply.code(409).send({ error: 'terminal_or_not_found' });
      const statusCode = result.kind === 'added' ? 201 : 200;
      return reply.code(statusCode).send({ kind: result.kind, reply: result.reply });
    },
  );

  // Lists replies for a help request in chronological order.
  // Learner (owner) may list their own request's replies.
  // Support staff may list any request's replies.
  app.get<{ Params: { id: string } }>(
    '/api/help/requests/:id/replies',
    authenticated_,
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID.test(id)) return reply.code(404).send({ error: 'not_found' });

      const principal = principalOf(request);
      let replies;

      if (principal.role === 'learner') {
        replies = await help.listReplies(principal, id);
      } else if (principal.role === 'support') {
        replies = await staffHelp.listReplies(principal, id);
      } else {
        return reply.code(403).send({ error: 'forbidden' });
      }

      if (replies === null) return reply.code(404).send({ error: 'not_found' });
      return { replies };
    },
  );

  // Marks all unread replies (by others) on the learner's own request as read.
  // Learner marks their staff-sent replies as read.
  // Support marks their learner-sent replies as read.
  app.put<{ Params: { id: string } }>(
    '/api/help/requests/:id/replies/read',
    authenticated_,
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID.test(id)) return reply.code(404).send({ error: 'not_found' });

      const principal = principalOf(request);
      let success;

      if (principal.role === 'learner') {
        success = await help.markRepliesRead(principal, id);
      } else if (principal.role === 'support') {
        success = await staffHelp.markRepliesRead(principal, id);
      } else {
        return reply.code(403).send({ error: 'forbidden' });
      }

      if (!success) return reply.code(404).send({ error: 'not_found' });
      return reply.code(204).send();
    },
  );

  // Resolves a claimed help request. Support-only.
  // Returns 200 with the updated request on success.
  // Returns 404 when the request does not exist, is not in claimed state, or has expired.
  app.post<{ Params: { id: string } }>(
    '/api/help/requests/:id/resolve',
    supportOnly,
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID.test(id)) return reply.code(404).send({ error: 'not_found' });

      const principal = principalOf(request);
      const resolved = await staffHelp.resolveRequest(principal, id);

      if (!resolved) return reply.code(404).send({ error: 'not_found' });
      return reply.code(200).send({ request: resolved });
    },
  );

  // Gets learner's notification preference for a channel (defaults to telegram).
  app.get('/api/help/notifications/preference', learnerOnly, async (request, reply) => {
    const principal = principalOf(request);
    const channel = (request.query as { channel?: string })?.channel ?? 'telegram';
    const optedIn = await help.getNotificationPreference(principal, channel);
    return reply.code(200).send({ channel, optedIn });
  });

  // Explicit opt-in for support reply notifications.
  app.post('/api/help/notifications/opt-in', learnerOnly, async (request, reply) => {
    const principal = principalOf(request);
    const channel = (request.body as { channel?: string })?.channel ?? 'telegram';
    await help.optIn(principal, channel);
    return reply.code(200).send({ channel, optedIn: true });
  });

  // Explicit opt-out for support reply notifications (suppresses pending intents).
  app.post('/api/help/notifications/opt-out', learnerOnly, async (request, reply) => {
    const principal = principalOf(request);
    const channel = (request.body as { channel?: string })?.channel ?? 'telegram';
    await help.optOut(principal, channel);
    return reply.code(200).send({ channel, optedIn: false });
  });

  // Updates notification preference for a channel.
  app.put<{ Body: { channel?: string; optedIn: boolean } }>(
    '/api/help/notifications/preference',
    learnerOnly,
    async (request, reply) => {
      const principal = principalOf(request);
      const { channel = 'telegram', optedIn } = request.body ?? {};
      if (typeof optedIn !== 'boolean') {
        return reply.code(400).send({ error: 'invalid_opted_in' });
      }
      await help.setNotificationPreference(principal, channel, optedIn);
      return reply.code(200).send({ channel, optedIn });
    },
  );

  if (screenshots) registerScreenshotRoutes(app, authenticated, screenshots);
}

// A screenshot is sent as the raw image body: no base64 overhead on a 3G phone.
function registerScreenshotRoutes(
  app: FastifyInstance,
  authenticated: preHandlerAsyncHookHandler,
  screenshots: HelpScreenshots,
) {
  app.addContentTypeParser(
    ['image/png', 'image/jpeg', 'image/webp'],
    { parseAs: 'buffer', bodyLimit: SCREENSHOT_MAX_BYTES },
    (_request, body, done) => done(null, body),
  );
  const learnerOnly = { preHandler: [authenticated, requireRole('learner')] };
  const path = '/api/help/requests/:id/screenshot';

  app.put<{ Params: { id: string }; Body: Buffer }>(path, learnerOnly, async (request, reply) => {
    const { id } = request.params;
    if (!UUID.test(id)) return reply.code(404).send({ error: 'not_found' });
    const mimeType = request.headers['content-type']?.split(';')[0]?.trim() ?? '';
    if (!isScreenshotMimeType(mimeType) || !Buffer.isBuffer(request.body)) {
      return reply.code(415).send({ error: 'unsupported_image_type' });
    }
    const result = await screenshots.attach(principalOf(request), id, {
      mimeType,
      data: request.body,
    });
    if (result === 'invalid_image') return reply.code(400).send({ error: 'invalid_image' });
    if (result === 'not_found') return reply.code(404).send({ error: 'not_found' });
    return reply.code(204).send();
  });

  app.delete<{ Params: { id: string } }>(path, learnerOnly, async (request, reply) => {
    const { id } = request.params;
    if (!UUID.test(id) || !(await screenshots.remove(principalOf(request), id))) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return reply.code(204).send();
  });

  // The owner, or the support person who claimed the request.
  app.get<{ Params: { id: string } }>(
    path,
    { preHandler: [authenticated] },
    async (request, reply) => {
      const { id } = request.params;
      const image = UUID.test(id) ? await screenshots.view(principalOf(request), id) : null;
      if (!image) return reply.code(404).send({ error: 'not_found' });
      return reply
        .header('content-type', image.mimeType)
        .header('cache-control', 'no-store')
        .send(image.data);
    },
  );
}
