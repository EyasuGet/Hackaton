// Real-PostgreSQL integration tests for sharing session signalling (T3-018-A).
// Tests: session ownership, expiry, revocation, and third-party rejection.
// This leaf proves signalling permissions only — not remote screen delivery.
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
import { Help } from '../help/application/help.ts';
import { StaffHelp } from '../help/application/staff-help.ts';
import type { HelpRequest } from '../help/domain/help-request.ts';
import { PostgresHelpRepository } from '../help/infrastructure/persistence/postgres-help-repository.ts';
import { Sharing } from './application/sharing.ts';
import type { SharingSession } from './domain/sharing-session.ts';
import { PostgresHelpRequestLookup } from './infrastructure/persistence/postgres-help-request-lookup.ts';
import { PostgresSharingRepository } from './infrastructure/persistence/postgres-sharing-repository.ts';

interface SubmitHelpResponse {
  readonly kind: 'submitted' | 'existing';
  readonly request: HelpRequest;
}

interface SessionResponse {
  readonly session: SharingSession;
}

const config = loadDatabaseConfig(process.env);
const testDatabase = `track3_test_sharing_${randomUUID().replaceAll('-', '')}`;
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
  const sharingRepository = new PostgresSharingRepository(pool);
  const helpLookup = new PostgresHelpRequestLookup(pool);
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
    sharing: new Sharing(sharingRepository, helpLookup),
  });
}

/** Submits a help request for learner-a and claims it as support. Returns helpRequestId. */
async function submitAndClaim(
  app: Awaited<ReturnType<typeof makeApp>>,
  clientRequestId: string,
): Promise<string> {
  const submitRes = await app.inject({
    method: 'POST',
    url: '/api/help/requests',
    headers: { authorization: `Bearer ${tokens['learner-a']}` },
    payload: { clientRequestId, contextSnapshot: 'sharing test context' },
  });
  expect(submitRes.statusCode).toBe(201);
  const requestId = submitRes.json<SubmitHelpResponse>().request.id;

  const claimRes = await app.inject({
    method: 'POST',
    url: `/api/help/requests/${requestId}/claim`,
    headers: { authorization: `Bearer ${tokens.support}` },
  });
  expect(claimRes.statusCode).toBe(200);
  return requestId;
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

describe('Sharing Session Integration (T3-018-A)', () => {
  it('support creates a session; state is pending', async () => {
    const app = makeApp();
    try {
      const helpRequestId = await submitAndClaim(app, 'sharing-initiate-1');

      const res = await app.inject({
        method: 'POST',
        url: '/api/sharing/sessions',
        headers: { authorization: `Bearer ${tokens.support}` },
        payload: { helpRequestId },
      });
      expect(res.statusCode).toBe(201);
      const { session } = res.json<SessionResponse>();
      expect(session.state).toBe('pending');
      expect(session.helpRequestId).toBe(helpRequestId);
      expect(session.revokedAt).toBeNull();
    } finally {
      await app.close();
    }
  });

  it('learner joins the session; state becomes active', async () => {
    const app = makeApp();
    try {
      const helpRequestId = await submitAndClaim(app, 'sharing-join-1');

      const initRes = await app.inject({
        method: 'POST',
        url: '/api/sharing/sessions',
        headers: { authorization: `Bearer ${tokens.support}` },
        payload: { helpRequestId },
      });
      expect(initRes.statusCode).toBe(201);
      const sessionId: string = initRes.json<SessionResponse>().session.id;

      const joinRes = await app.inject({
        method: 'POST',
        url: `/api/sharing/sessions/${sessionId}/join`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      expect(joinRes.statusCode).toBe(200);
      expect(joinRes.json<SessionResponse>().session.state).toBe('active');
    } finally {
      await app.close();
    }
  });

  it('third-party learner is rejected (404) when joining', async () => {
    const app = makeApp();
    try {
      const helpRequestId = await submitAndClaim(app, 'sharing-third-party-1');

      const initRes = await app.inject({
        method: 'POST',
        url: '/api/sharing/sessions',
        headers: { authorization: `Bearer ${tokens.support}` },
        payload: { helpRequestId },
      });
      expect(initRes.statusCode).toBe(201);
      const sessionId: string = initRes.json<SessionResponse>().session.id;

      // learner-b is unrelated to this help request
      const thirdPartyRes = await app.inject({
        method: 'POST',
        url: `/api/sharing/sessions/${sessionId}/join`,
        headers: { authorization: `Bearer ${tokens['learner-b']}` },
      });
      expect(thirdPartyRes.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('third-party learner cannot get session state', async () => {
    const app = makeApp();
    try {
      const helpRequestId = await submitAndClaim(app, 'sharing-third-party-get-1');

      const initRes = await app.inject({
        method: 'POST',
        url: '/api/sharing/sessions',
        headers: { authorization: `Bearer ${tokens.support}` },
        payload: { helpRequestId },
      });
      expect(initRes.statusCode).toBe(201);
      const sessionId: string = initRes.json<SessionResponse>().session.id;

      const thirdPartyRes = await app.inject({
        method: 'GET',
        url: `/api/sharing/sessions/${sessionId}`,
        headers: { authorization: `Bearer ${tokens['learner-b']}` },
      });
      expect(thirdPartyRes.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('either participant can revoke; state becomes revoked', async () => {
    const app = makeApp();
    try {
      const helpRequestId = await submitAndClaim(app, 'sharing-revoke-1');

      const initRes = await app.inject({
        method: 'POST',
        url: '/api/sharing/sessions',
        headers: { authorization: `Bearer ${tokens.support}` },
        payload: { helpRequestId },
      });
      expect(initRes.statusCode).toBe(201);
      const sessionId: string = initRes.json<SessionResponse>().session.id;

      const revokeRes = await app.inject({
        method: 'DELETE',
        url: `/api/sharing/sessions/${sessionId}`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      expect(revokeRes.statusCode).toBe(200);
      expect(revokeRes.json<SessionResponse>().session.state).toBe('revoked');
      expect(revokeRes.json<SessionResponse>().session.revokedAt).not.toBeNull();
    } finally {
      await app.close();
    }
  });

  it('action on revoked session returns 409 invalid_state for join', async () => {
    const app = makeApp();
    try {
      const helpRequestId = await submitAndClaim(app, 'sharing-revoked-join-1');

      const initRes = await app.inject({
        method: 'POST',
        url: '/api/sharing/sessions',
        headers: { authorization: `Bearer ${tokens.support}` },
        payload: { helpRequestId },
      });
      expect(initRes.statusCode).toBe(201);
      const sessionId: string = initRes.json<SessionResponse>().session.id;

      await app.inject({
        method: 'DELETE',
        url: `/api/sharing/sessions/${sessionId}`,
        headers: { authorization: `Bearer ${tokens.support}` },
      });

      const joinRes = await app.inject({
        method: 'POST',
        url: `/api/sharing/sessions/${sessionId}/join`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      expect(joinRes.statusCode).toBe(409);
      expect(joinRes.json<{ error: string; state: string }>().state).toBe('revoked');
    } finally {
      await app.close();
    }
  });

  it('a learner who does not own the help request cannot initiate a session', async () => {
    const app = makeApp();
    try {
      const helpRequestId = await submitAndClaim(app, 'sharing-learner-initiate-1');

      // learner-a owns the request, but learner-b should not be able to initiate
      const res = await app.inject({
        method: 'POST',
        url: '/api/sharing/sessions',
        headers: { authorization: `Bearer ${tokens['learner-b']}` },
        payload: { helpRequestId },
      });
      // learner role is forbidden from initiating (only support may)
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('support who did not claim the request cannot initiate a session', async () => {
    // The demo set has only one support principal, so we test the missing-claim case
    // by using a help request that is still in waiting state (not claimed).
    const app = makeApp();
    try {
      const submitRes = await app.inject({
        method: 'POST',
        url: '/api/help/requests',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
        payload: {
          clientRequestId: 'sharing-unclaimed-1',
          contextSnapshot: 'unclaimed help request',
        },
      });
      expect(submitRes.statusCode).toBe(201);
      const helpRequestId = submitRes.json<SubmitHelpResponse>().request.id;

      const res = await app.inject({
        method: 'POST',
        url: '/api/sharing/sessions',
        headers: { authorization: `Bearer ${tokens.support}` },
        payload: { helpRequestId },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('expired session cannot be joined', async () => {
    // Force-expire the session in the database and attempt to join.
    const app = makeApp();
    try {
      const helpRequestId = await submitAndClaim(app, 'sharing-expire-1');

      const initRes = await app.inject({
        method: 'POST',
        url: '/api/sharing/sessions',
        headers: { authorization: `Bearer ${tokens.support}` },
        payload: { helpRequestId },
      });
      expect(initRes.statusCode).toBe(201);
      const sessionId: string = initRes.json<SessionResponse>().session.id;

      // Directly expire via the repository
      await pool.query(
        `UPDATE sharing_sessions SET state = 'expired', expires_at = now() - interval '1 second'
         WHERE id = $1`,
        [sessionId],
      );

      const joinRes = await app.inject({
        method: 'POST',
        url: `/api/sharing/sessions/${sessionId}/join`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      expect(joinRes.statusCode).toBe(409);
      expect(joinRes.json<{ state: string }>().state).toBe('expired');
    } finally {
      await app.close();
    }
  });
});
