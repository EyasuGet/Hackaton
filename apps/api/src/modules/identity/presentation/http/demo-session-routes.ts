// HTTP contract for synthetic demo sessions (T3-004-C). The browser exchanges a
// single-use handoff code for a session token, held in page memory and sent as
// `Authorization: Bearer`, so the embed does not depend on third-party cookies.
import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import type { DemoSessions } from '../../application/demo-sessions.ts';
import { bearerToken } from './authentication.ts';

const exchangeSchema = {
  body: {
    type: 'object',
    required: ['code'],
    additionalProperties: false,
    properties: { code: { type: 'string', pattern: '^[A-Za-z0-9_-]{20,128}$' } },
  },
} as const;

export function registerDemoSessionRoutes(
  app: FastifyInstance,
  authenticated: preHandlerAsyncHookHandler,
  demoSessions: DemoSessions,
  allowedOrigins: readonly string[],
) {
  app.post<{ Body: { code: string } }>(
    '/api/demo/session',
    { schema: exchangeSchema },
    async (request, reply) => {
      // Only listed page origins may sign in; this runs before the code is
      // touched, so a refused attempt does not use up the code.
      const origin = request.headers.origin;
      if (!origin || !allowedOrigins.includes(origin)) {
        return reply.code(403).send({ error: 'origin_not_allowed' });
      }
      const session = await demoSessions.exchange(request.body.code);
      if (!session) return reply.code(401).send({ error: 'invalid_handoff' });
      return reply
        .code(201)
        .send({ token: session.secret, expiresAt: session.expiresAt.toISOString() });
    },
  );

  app.delete('/api/demo/session', { preHandler: authenticated }, async (request, reply) => {
    const token = bearerToken(request);
    if (token) await demoSessions.revoke(token);
    return reply.code(204).send();
  });
}
