// Real-PostgreSQL integration tests for help request replies and resolution (T3-017-B).
// Tests: reply persistence, idempotency, ownership isolation, resolution state,
// terminal-state rejection, and reply ordering.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../bootstrap/app.ts';
import { loadDatabaseConfig } from '../../bootstrap/config.ts';
import { createPool } from '../../infrastructure/database/connection.ts';
import {
  loadMigrations,
  migrate,
  MIGRATIONS_DIR,
} from '../../infrastructure/database/migrations.ts';
import { DemoRecords } from '../demo-records/demo-records.ts';
import {
  PostgresDemoRecordRepository,
  seedDemoRecords,
} from '../demo-records/postgres-demo-record-repository.ts';
import { DemoSessions } from '../identity/application/demo-sessions.ts';
import { ResolvePrincipal } from '../identity/application/resolve-principal.ts';
import { PostgresDemoSessionRepository } from '../identity/infrastructure/postgres-demo-session-repository.ts';
import {
  PostgresPrincipalRepository,
  provisionDemoPrincipals,
  type DemoCredential,
  type DemoPrincipalKey,
} from '../identity/infrastructure/postgres-principal-repository.ts';
import { Tutoring } from '../tutoring/application/tutoring.ts';
import { PostgresTutoringRepository } from '../tutoring/infrastructure/persistence/postgres-tutoring-repository.ts';
import { ContentAccess } from '../content/application/content-access.ts';
import { Help } from './application/help.ts';
import { StaffHelp } from './application/staff-help.ts';
import type { HelpReply, HelpRequest } from './domain/help-request.ts';
import { PostgresHelpRepository } from './infrastructure/persistence/postgres-help-repository.ts';

interface SubmitResponse {
  readonly kind: 'submitted' | 'existing';
  readonly request: HelpRequest;
}

interface ReplyResponse {
  readonly kind: 'added' | 'existing';
  readonly reply: HelpReply;
}

interface RepliesResponse {
  readonly replies: readonly HelpReply[];
}

const config = loadDatabaseConfig(process.env);
const testDatabase = `track3_test_replies_${randomUUID().replaceAll('-', '')}`;
let admin: pg.Pool;
let pool: pg.Pool;
let tokens: Record<DemoPrincipalKey, string>;

async function provision(): Promise<Record<DemoPrincipalKey, string>> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const credentials: DemoCredential[] = await provisionDemoPrincipals(client);
    await seedDemoRecords(client, new Map(credentials.map((c) => [c.key, c.id])));
    await client.query('COMMIT');
    return Object.fromEntries(credentials.map((c) => [c.key, c.token])) as Record<
      DemoPrincipalKey,
      string
    >;
  } finally {
    client.release();
  }
}

function makeApp() {
  const helpRepository = new PostgresHelpRepository(pool);
  return buildApp({
    checkReadiness: () => Promise.resolve({ ready: true }),
    resolvePrincipal: new ResolvePrincipal(new PostgresPrincipalRepository(pool), true),
    demoRecords: new DemoRecords(new PostgresDemoRecordRepository(pool)),
    demoSessions: new DemoSessions(new PostgresDemoSessionRepository(pool), true),
    demoAllowedOrigins: ['http://localhost:5173'],
    tutoring: new Tutoring(new PostgresTutoringRepository(pool)),
    content: new ContentAccess(
      { search: () => Promise.resolve([]), resolve: () => Promise.resolve({ kind: 'not_found' }) },
      [],
    ),
    help: new Help(helpRepository),
    staffHelp: new StaffHelp(helpRepository),
  });
}

/** Submits a request as learner-a and returns its id. */
async function submitRequest(app: ReturnType<typeof makeApp>, key: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/help/requests',
    headers: { authorization: `Bearer ${tokens['learner-a']}` },
    payload: { clientRequestId: key, contextSnapshot: `Context for ${key}.` },
  });
  expect(res.statusCode).toBe(201);
  return res.json<SubmitResponse>().request.id;
}

/** Claims a request as support and returns the response body. */
async function claimRequest(
  app: ReturnType<typeof makeApp>,
  id: string,
): Promise<{ request: HelpRequest }> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/help/requests/${id}/claim`,
    headers: { authorization: `Bearer ${tokens.support}` },
  });
  expect(res.statusCode).toBe(200);
  return res.json<{ request: HelpRequest }>();
}

beforeAll(async () => {
  admin = createPool(config, () => {});
  await admin.query(`CREATE DATABASE ${testDatabase}`);
  pool = createPool({ ...config, database: testDatabase }, () => {});
  await migrate(pool, await loadMigrations(MIGRATIONS_DIR));
  tokens = await provision();
});

afterAll(async () => {
  await pool?.end();
  await admin?.query(`DROP DATABASE IF EXISTS ${testDatabase} WITH (FORCE)`);
  await admin?.end();
});

describe('Help Replies Integration (T3-017-B)', () => {
  it('learner can add a reply to their own waiting request and it persists', async () => {
    const app = makeApp();
    try {
      const id = await submitRequest(app, 'reply-learner-persist-1');

      const replyRes = await app.inject({
        method: 'POST',
        url: `/api/help/requests/${id}/replies`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
        payload: { clientReplyId: 'lr-1', body: 'Learner first reply.' },
      });
      expect(replyRes.statusCode).toBe(201);
      const { kind, reply } = replyRes.json<ReplyResponse>();
      expect(kind).toBe('added');
      expect(reply.body).toBe('Learner first reply.');
      expect(reply.helpRequestId).toBe(id);

      // Verify it persists via listReplies.
      const listRes = await app.inject({
        method: 'GET',
        url: `/api/help/requests/${id}/replies`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      expect(listRes.statusCode).toBe(200);
      const { replies } = listRes.json<RepliesResponse>();
      expect(replies).toHaveLength(1);
      expect(replies[0]?.body).toBe('Learner first reply.');
    } finally {
      await app.close();
    }
  });

  it('support staff can add a reply to a claimed request and it persists', async () => {
    const app = makeApp();
    try {
      const id = await submitRequest(app, 'reply-staff-persist-1');
      await claimRequest(app, id);

      const replyRes = await app.inject({
        method: 'POST',
        url: `/api/help/requests/${id}/replies`,
        headers: { authorization: `Bearer ${tokens.support}` },
        payload: { clientReplyId: 'sr-1', body: 'Staff first reply.' },
      });
      expect(replyRes.statusCode).toBe(201);
      const { kind, reply } = replyRes.json<ReplyResponse>();
      expect(kind).toBe('added');
      expect(reply.body).toBe('Staff first reply.');

      // Verify it persists via listReplies (support can read their own requests).
      const listRes = await app.inject({
        method: 'GET',
        url: `/api/help/requests/${id}/replies`,
        headers: { authorization: `Bearer ${tokens.support}` },
      });
      expect(listRes.statusCode).toBe(200);
      const { replies } = listRes.json<RepliesResponse>();
      expect(replies.some((r: HelpReply) => r.body === 'Staff first reply.')).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('duplicate clientReplyId returns idempotent result without creating a second row', async () => {
    const app = makeApp();
    try {
      const id = await submitRequest(app, 'reply-idempotent-1');

      const payload = { clientReplyId: 'idempotent-key-1', body: 'Original reply body.' };

      const res1 = await app.inject({
        method: 'POST',
        url: `/api/help/requests/${id}/replies`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
        payload,
      });
      expect(res1.statusCode).toBe(201);
      const id1 = res1.json<ReplyResponse>().reply.id;

      // Same clientReplyId, different body — must return the original.
      const res2 = await app.inject({
        method: 'POST',
        url: `/api/help/requests/${id}/replies`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
        payload: { ...payload, body: 'Retry with different body.' },
      });
      expect(res2.statusCode).toBe(200);
      const body2 = res2.json<ReplyResponse>();
      expect(body2.kind).toBe('existing');
      expect(body2.reply.id).toBe(id1);
      expect(body2.reply.body).toBe('Original reply body.');

      // Exactly one database row for this clientReplyId on this request.
      const count = await pool.query<{ count: string }>(
        'SELECT count(*) FROM help_request_replies WHERE help_request_id = $1 AND client_reply_id = $2',
        [id, 'idempotent-key-1'],
      );
      expect(Number(count.rows[0]?.count)).toBe(1);
    } finally {
      await app.close();
    }
  });

  it("learner cannot add a reply to another learner's request", async () => {
    const app = makeApp();
    try {
      const id = await submitRequest(app, 'reply-ownership-1');

      // Learner B tries to reply to Learner A's request.
      const replyRes = await app.inject({
        method: 'POST',
        url: `/api/help/requests/${id}/replies`,
        headers: { authorization: `Bearer ${tokens['learner-b']}` },
        payload: { clientReplyId: 'lr-owner-1', body: 'Unauthorized reply.' },
      });
      // 409 means terminal_or_not_found (the request is not found for this learner).
      expect(replyRes.statusCode).toBe(409);
    } finally {
      await app.close();
    }
  });

  it('support resolves a claimed request and state changes to resolved', async () => {
    const app = makeApp();
    try {
      const id = await submitRequest(app, 'reply-resolve-1');
      await claimRequest(app, id);

      const resolveRes = await app.inject({
        method: 'POST',
        url: `/api/help/requests/${id}/resolve`,
        headers: { authorization: `Bearer ${tokens.support}` },
      });
      expect(resolveRes.statusCode).toBe(200);
      const { request } = resolveRes.json<{ request: HelpRequest }>();
      expect(request.state).toBe('resolved');
      expect(request.resolvedAt).not.toBeNull();
      expect(request.resolvedBy).not.toBeNull();
    } finally {
      await app.close();
    }
  });

  it('cannot add reply to a resolved request (409)', async () => {
    const app = makeApp();
    try {
      const id = await submitRequest(app, 'reply-after-resolve-1');
      await claimRequest(app, id);

      await app.inject({
        method: 'POST',
        url: `/api/help/requests/${id}/resolve`,
        headers: { authorization: `Bearer ${tokens.support}` },
      });

      const replyRes = await app.inject({
        method: 'POST',
        url: `/api/help/requests/${id}/replies`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
        payload: { clientReplyId: 'lr-after-resolve-1', body: 'Reply after resolve.' },
      });
      expect(replyRes.statusCode).toBe(409);
    } finally {
      await app.close();
    }
  });

  it('cannot add reply to a cancelled request (409)', async () => {
    const app = makeApp();
    try {
      const id = await submitRequest(app, 'reply-after-cancel-1');

      await app.inject({
        method: 'DELETE',
        url: `/api/help/requests/${id}`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });

      const replyRes = await app.inject({
        method: 'POST',
        url: `/api/help/requests/${id}/replies`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
        payload: { clientReplyId: 'lr-after-cancel-1', body: 'Reply after cancel.' },
      });
      expect(replyRes.statusCode).toBe(409);
    } finally {
      await app.close();
    }
  });

  it('listReplies returns replies in chronological order', async () => {
    const app = makeApp();
    try {
      const id = await submitRequest(app, 'reply-order-1');
      await claimRequest(app, id);

      // Add replies with a small delay to ensure distinct timestamps.
      for (const [i, body] of ['first', 'second', 'third'].entries()) {
        await app.inject({
          method: 'POST',
          url: `/api/help/requests/${id}/replies`,
          headers: { authorization: `Bearer ${tokens['learner-a']}` },
          payload: { clientReplyId: `order-key-${i}`, body: `Reply ${body}.` },
        });
      }

      const listRes = await app.inject({
        method: 'GET',
        url: `/api/help/requests/${id}/replies`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      expect(listRes.statusCode).toBe(200);
      const { replies } = listRes.json<RepliesResponse>();
      expect(replies.length).toBeGreaterThanOrEqual(3);

      // Verify ascending chronological order.
      for (let i = 1; i < replies.length; i++) {
        const prev = replies[i - 1];
        const curr = replies[i];
        if (prev && curr) {
          expect(new Date(prev.createdAt).getTime()).toBeLessThanOrEqual(
            new Date(curr.createdAt).getTime(),
          );
        }
      }
    } finally {
      await app.close();
    }
  });

  it('mark-read endpoint marks staff replies as read for the learner', async () => {
    const app = makeApp();
    try {
      const id = await submitRequest(app, 'reply-read-state-1');
      await claimRequest(app, id);

      // Staff sends a reply.
      await app.inject({
        method: 'POST',
        url: `/api/help/requests/${id}/replies`,
        headers: { authorization: `Bearer ${tokens.support}` },
        payload: { clientReplyId: 'read-sr-1', body: 'Staff reply for read test.' },
      });

      // Learner marks replies as read.
      const markRes = await app.inject({
        method: 'PUT',
        url: `/api/help/requests/${id}/replies/read`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      expect(markRes.statusCode).toBe(204);

      // Verify read_at is now set for the staff reply.
      const dbRes = await pool.query<{ read_at: Date | null }>(
        `SELECT read_at FROM help_request_replies WHERE help_request_id = $1 AND client_reply_id = 'read-sr-1'`,
        [id],
      );
      expect(dbRes.rows[0]?.read_at).not.toBeNull();
    } finally {
      await app.close();
    }
  });

  it('learner cannot resolve a request (403)', async () => {
    const app = makeApp();
    try {
      const id = await submitRequest(app, 'reply-learner-resolve-1');
      await claimRequest(app, id);

      const resolveRes = await app.inject({
        method: 'POST',
        url: `/api/help/requests/${id}/resolve`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      expect(resolveRes.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('new replies are rejected on an expired help request (409)', async () => {
    const app = makeApp();
    try {
      const id = await submitRequest(app, 'reply-expiry-1');
      await claimRequest(app, id);

      // Force request into expired state (past expires_at).
      await pool.query(
        "UPDATE help_requests SET expires_at = now() - interval '1 hour' WHERE id = $1",
        [id],
      );

      const replyRes = await app.inject({
        method: 'POST',
        url: `/api/help/requests/${id}/replies`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
        payload: { clientReplyId: 'lr-expired-1', body: 'Reply on expired request.' },
      });
      expect(replyRes.statusCode).toBe(409);
    } finally {
      await app.close();
    }
  });

  it('expired requests cannot be resolved (404)', async () => {
    const app = makeApp();
    try {
      const id = await submitRequest(app, 'reply-expiry-resolve-1');
      await claimRequest(app, id);

      // Force request into expired state.
      await pool.query(
        "UPDATE help_requests SET expires_at = now() - interval '1 hour' WHERE id = $1",
        [id],
      );

      const resolveRes = await app.inject({
        method: 'POST',
        url: `/api/help/requests/${id}/resolve`,
        headers: { authorization: `Bearer ${tokens.support}` },
      });
      expect(resolveRes.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('resolution does not alter or extend expires_at retention anchor', async () => {
    const app = makeApp();
    try {
      const id = await submitRequest(app, 'reply-retention-1');
      await claimRequest(app, id);

      const before = await pool.query<{ expires_at: Date }>(
        'SELECT expires_at FROM help_requests WHERE id = $1',
        [id],
      );
      const originalExpiresAt = before.rows[0]?.expires_at.toISOString();

      const resolveRes = await app.inject({
        method: 'POST',
        url: `/api/help/requests/${id}/resolve`,
        headers: { authorization: `Bearer ${tokens.support}` },
      });
      expect(resolveRes.statusCode).toBe(200);

      const after = await pool.query<{ expires_at: Date }>(
        'SELECT expires_at FROM help_requests WHERE id = $1',
        [id],
      );
      expect(after.rows[0]?.expires_at.toISOString()).toBe(originalExpiresAt);
    } finally {
      await app.close();
    }
  });
});
