// HTTP authentication and role checks for protected routes. The principal comes
// only from the bearer credential; role, owner or course values in headers,
// query strings or bodies are ignored.
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler,
} from 'fastify';
import type { ResolvePrincipal } from '../../application/resolve-principal.ts';
import type { Principal, Role } from '../../domain/principal.ts';

declare module 'fastify' {
  interface FastifyRequest {
    principal: Principal | null;
  }
}

// Demo tokens are 32 random bytes in base64url (43 characters); allow some
// headroom but reject anything that could not be one before touching the database.
const BEARER = /^Bearer ([A-Za-z0-9_-]{20,128})$/i;

const DEMO_NOTICE = 'Synthetic demo identity — not real authentication';

/** The well-formed bearer token on a request, if any. */
export function bearerToken(request: FastifyRequest): string | undefined {
  return BEARER.exec(request.headers.authorization ?? '')?.[1];
}

export function authenticate(resolvePrincipal: ResolvePrincipal): preHandlerAsyncHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const token = bearerToken(request);
    const principal = token ? await resolvePrincipal.execute(token) : null;
    if (!principal) return reply.code(401).send({ error: 'unauthenticated' });
    request.principal = principal;
  };
}

/** Must run after authenticate(). */
export function requireRole(...roles: readonly Role[]): preHandlerAsyncHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.principal || !roles.includes(request.principal.role))
      return reply.code(403).send({ error: 'forbidden' });
  };
}

/** The authenticated principal of a route protected by authenticate(). */
export function principalOf(request: FastifyRequest): Principal {
  // Reaching a handler without a principal means authenticate() was not wired in.
  if (!request.principal) throw new Error('Route is missing the authenticate preHandler');
  return request.principal;
}

export function registerIdentityRoutes(app: FastifyInstance, resolvePrincipal: ResolvePrincipal) {
  app.decorateRequest('principal', null);

  app.get('/api/me', { preHandler: authenticate(resolvePrincipal) }, (request) => {
    const { id, role, label, demo, courseIds } = principalOf(request);
    return { id, role, label, courseIds, demo, ...(demo ? { notice: DEMO_NOTICE } : {}) };
  });
}
