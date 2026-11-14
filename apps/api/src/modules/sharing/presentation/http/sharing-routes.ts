// HTTP presentation routes for sharing session signalling (T3-018-A).
// Routes restrict access to the two authorised participants (learner owner and
// support person who claimed the help request). No screen delivery happens here.
import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import { principalOf } from '../../../identity/presentation/http/authentication.ts';
import type { Sharing } from '../../application/sharing.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface InitiateBody {
  helpRequestId: string;
}

export function registerSharingRoutes(
  app: FastifyInstance,
  authenticated: preHandlerAsyncHookHandler,
  sharing: Sharing,
) {
  const authOnly = { preHandler: [authenticated] };

  // Initiates a sharing session. Support-only by use-case enforcement.
  app.post<{ Body: InitiateBody }>('/api/sharing/sessions', authOnly, async (request, reply) => {
    const { helpRequestId } = request.body ?? {};
    if (!helpRequestId || typeof helpRequestId !== 'string' || !UUID.test(helpRequestId)) {
      return reply.code(400).send({ error: 'invalid_help_request_id' });
    }

    const principal = principalOf(request);
    const result = await sharing.initiateSession(principal, helpRequestId);
    if (!result.ok) {
      const { kind } = result.error;
      if (kind === 'not_found') return reply.code(404).send({ error: 'not_found' });
      return reply.code(403).send({ error: 'forbidden' });
    }
    return reply.code(201).send({ session: result.value });
  });

  // Joins (activates) a session. Either participant may join.
  app.post<{ Params: { id: string } }>(
    '/api/sharing/sessions/:id/join',
    authOnly,
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID.test(id)) return reply.code(404).send({ error: 'not_found' });

      const principal = principalOf(request);
      const result = await sharing.joinSession(principal, id);
      if (!result.ok) {
        const { kind } = result.error;
        if (kind === 'not_found') return reply.code(404).send({ error: 'not_found' });
        if (kind === 'invalid_state') {
          return reply.code(409).send({ error: 'invalid_state', state: result.error.state });
        }
        return reply.code(403).send({ error: 'forbidden' });
      }
      return reply.code(200).send({ session: result.value });
    },
  );

  // Revokes a session. Either participant may revoke.
  app.delete<{ Params: { id: string } }>(
    '/api/sharing/sessions/:id',
    authOnly,
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID.test(id)) return reply.code(404).send({ error: 'not_found' });

      const principal = principalOf(request);
      const result = await sharing.revokeSession(principal, id);
      if (!result.ok) {
        const { kind } = result.error;
        if (kind === 'not_found') return reply.code(404).send({ error: 'not_found' });
        if (kind === 'invalid_state') {
          return reply.code(409).send({ error: 'invalid_state', state: result.error.state });
        }
        return reply.code(403).send({ error: 'forbidden' });
      }
      return reply.code(200).send({ session: result.value });
    },
  );

  // Returns current session state for an authorised participant.
  app.get<{ Params: { id: string } }>(
    '/api/sharing/sessions/:id',
    authOnly,
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID.test(id)) return reply.code(404).send({ error: 'not_found' });

      const principal = principalOf(request);
      const result = await sharing.getSession(principal, id);
      if (!result.ok) {
        const { kind } = result.error;
        if (kind === 'not_found') return reply.code(404).send({ error: 'not_found' });
        return reply.code(403).send({ error: 'forbidden' });
      }
      return reply.code(200).send({ session: result.value });
    },
  );
}
