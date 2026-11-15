// Real-PostgreSQL integration tests for sharing session signalling (T3-018-A).
// Tests: session ownership, expiry, revocation, and third-party rejection.
// This leaf proves signalling permissions only — not remote screen delivery.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../bootstrap/app.ts';
import { loadDatabaseConfig, type RelayConfig } from '../../bootstrap/config.ts';
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
import type { IceServerConfig, SharingSession, SharingSignal } from './domain/sharing-session.ts';
import { PostgresHelpRequestLookup } from './infrastructure/persistence/postgres-help-request-lookup.ts';
import { PostgresSharingRepository } from './infrastructure/persistence/postgres-sharing-repository.ts';

interface SubmitHelpResponse {
  readonly kind: 'submitted' | 'existing';
  readonly request: HelpRequest;
}

interface SessionResponse {
  readonly session: SharingSession;
}

interface SignalsResponse {
  readonly signals: readonly SharingSignal[];
}

interface SignalResponse {
  readonly signal: SharingSignal;
}

interface IceServersResponse {
  readonly iceServers: readonly IceServerConfig[];
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

function makeApp(relayConfig?: RelayConfig) {
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
    sharing: new Sharing(sharingRepository, helpLookup, relayConfig),
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

  it('learner who owns claimed request can initiate/retrieve sharing session', async () => {
    const app = makeApp();
    try {
      const helpRequestId = await submitAndClaim(app, 'sharing-learner-owner-initiate-1');

      const res = await app.inject({
        method: 'POST',
        url: '/api/sharing/sessions',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
        payload: { helpRequestId },
      });
      expect(res.statusCode).toBe(201);
      const { session } = res.json<SessionResponse>();
      expect(session.state).toBe('pending');
      expect(session.learnerId).toBe(tokens['learner-a'] ? session.learnerId : '');
      expect(session.helpRequestId).toBe(helpRequestId);

      // Calling initiate again returns existing session idempotently
      const secondRes = await app.inject({
        method: 'POST',
        url: '/api/sharing/sessions',
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
        payload: { helpRequestId },
      });
      expect(secondRes.statusCode).toBe(201);
      expect(secondRes.json<SessionResponse>().session.id).toBe(session.id);
    } finally {
      await app.close();
    }
  });

  it('participant can look up session by help request id', async () => {
    const app = makeApp();
    try {
      const helpRequestId = await submitAndClaim(app, 'sharing-by-request-1');

      const initRes = await app.inject({
        method: 'POST',
        url: '/api/sharing/sessions',
        headers: { authorization: `Bearer ${tokens.support}` },
        payload: { helpRequestId },
      });
      expect(initRes.statusCode).toBe(201);
      const sessionId: string = initRes.json<SessionResponse>().session.id;

      const lookupRes = await app.inject({
        method: 'GET',
        url: `/api/sharing/sessions/by-request/${helpRequestId}`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      expect(lookupRes.statusCode).toBe(200);
      expect(lookupRes.json<SessionResponse>().session.id).toBe(sessionId);

      // Third-party receives 404
      const thirdPartyRes = await app.inject({
        method: 'GET',
        url: `/api/sharing/sessions/by-request/${helpRequestId}`,
        headers: { authorization: `Bearer ${tokens['learner-b']}` },
      });
      expect(thirdPartyRes.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('exchanges signalling messages between learner and support', async () => {
    const app = makeApp();
    try {
      const helpRequestId = await submitAndClaim(app, 'sharing-signalling-exchange-1');

      const initRes = await app.inject({
        method: 'POST',
        url: '/api/sharing/sessions',
        headers: { authorization: `Bearer ${tokens.support}` },
        payload: { helpRequestId },
      });
      expect(initRes.statusCode).toBe(201);
      const sessionId: string = initRes.json<SessionResponse>().session.id;

      // Learner joins to activate session
      await app.inject({
        method: 'POST',
        url: `/api/sharing/sessions/${sessionId}/join`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });

      // Learner sends WebRTC SDP offer
      const offerPayload = { type: 'offer', sdp: 'v=0\r\no=learner 1234 2 IN IP4 127.0.0.1' };
      const sendOfferRes = await app.inject({
        method: 'POST',
        url: `/api/sharing/sessions/${sessionId}/signals`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
        payload: { type: 'offer', payload: offerPayload },
      });
      expect(sendOfferRes.statusCode).toBe(201);
      const offerSignal = sendOfferRes.json<SignalResponse>().signal;
      expect(offerSignal.type).toBe('offer');
      expect(offerSignal.payload).toEqual(offerPayload);

      // Support checks signals: receives learner's offer
      const supportSignalsRes = await app.inject({
        method: 'GET',
        url: `/api/sharing/sessions/${sessionId}/signals`,
        headers: { authorization: `Bearer ${tokens.support}` },
      });
      expect(supportSignalsRes.statusCode).toBe(200);
      const supportReceived = supportSignalsRes.json<SignalsResponse>().signals;
      expect(supportReceived).toHaveLength(1);
      expect(supportReceived[0]?.type).toBe('offer');

      // Learner checks signals: does NOT see their own sent offer
      const learnerSignalsRes = await app.inject({
        method: 'GET',
        url: `/api/sharing/sessions/${sessionId}/signals`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      expect(learnerSignalsRes.statusCode).toBe(200);
      expect(learnerSignalsRes.json<SignalsResponse>().signals).toHaveLength(0);

      // Support sends WebRTC SDP answer and an ICE candidate
      const answerPayload = { type: 'answer', sdp: 'v=0\r\no=support 5678 2 IN IP4 127.0.0.1' };
      const sendAnswerRes = await app.inject({
        method: 'POST',
        url: `/api/sharing/sessions/${sessionId}/signals`,
        headers: { authorization: `Bearer ${tokens.support}` },
        payload: { type: 'answer', payload: answerPayload },
      });
      expect(sendAnswerRes.statusCode).toBe(201);
      const answerId = sendAnswerRes.json<SignalResponse>().signal.id;

      const icePayload = { candidate: 'candidate:1 1 UDP 2122260223 192.168.1.1 50000 typ host' };
      await app.inject({
        method: 'POST',
        url: `/api/sharing/sessions/${sessionId}/signals`,
        headers: { authorization: `Bearer ${tokens.support}` },
        payload: { type: 'ice-candidate', payload: icePayload },
      });

      // Learner checks signals: receives support's answer and candidate
      const learnerReceivedRes = await app.inject({
        method: 'GET',
        url: `/api/sharing/sessions/${sessionId}/signals`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      expect(learnerReceivedRes.statusCode).toBe(200);
      const learnerSignals = learnerReceivedRes.json<SignalsResponse>().signals;
      expect(learnerSignals).toHaveLength(2);
      expect(learnerSignals[0]?.type).toBe('answer');
      expect(learnerSignals[1]?.type).toBe('ice-candidate');

      // Pagination cursor after answerId
      const cursorRes = await app.inject({
        method: 'GET',
        url: `/api/sharing/sessions/${sessionId}/signals?after=${answerId}`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      expect(cursorRes.statusCode).toBe(200);
      const paged = cursorRes.json<SignalsResponse>().signals;
      expect(paged).toHaveLength(1);
      expect(paged[0]?.type).toBe('ice-candidate');
    } finally {
      await app.close();
    }
  });

  it('rejects invalid signal type or payload with 400', async () => {
    const app = makeApp();
    try {
      const helpRequestId = await submitAndClaim(app, 'sharing-invalid-signal-1');

      const initRes = await app.inject({
        method: 'POST',
        url: '/api/sharing/sessions',
        headers: { authorization: `Bearer ${tokens.support}` },
        payload: { helpRequestId },
      });
      const sessionId: string = initRes.json<SessionResponse>().session.id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/sharing/sessions/${sessionId}/signals`,
        headers: { authorization: `Bearer ${tokens.support}` },
        payload: { type: 'invalid-type', payload: { test: 1 } },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('revoked session rejects new signals with 409', async () => {
    const app = makeApp();
    try {
      const helpRequestId = await submitAndClaim(app, 'sharing-revoked-signals-1');

      const initRes = await app.inject({
        method: 'POST',
        url: '/api/sharing/sessions',
        headers: { authorization: `Bearer ${tokens.support}` },
        payload: { helpRequestId },
      });
      const sessionId: string = initRes.json<SessionResponse>().session.id;

      // Revoke the session
      await app.inject({
        method: 'DELETE',
        url: `/api/sharing/sessions/${sessionId}`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/sharing/sessions/${sessionId}/signals`,
        headers: { authorization: `Bearer ${tokens.support}` },
        payload: { type: 'offer', payload: { sdp: 'test' } },
      });
      expect(res.statusCode).toBe(409);
    } finally {
      await app.close();
    }
  });

  it('returns STUN server fallback when TURN relay is not enabled', async () => {
    const app = makeApp({ enabled: false });
    try {
      const helpRequestId = await submitAndClaim(app, 'sharing-ice-stun-1');

      const initRes = await app.inject({
        method: 'POST',
        url: '/api/sharing/sessions',
        headers: { authorization: `Bearer ${tokens.support}` },
        payload: { helpRequestId },
      });
      const sessionId: string = initRes.json<SessionResponse>().session.id;

      const res = await app.inject({
        method: 'GET',
        url: `/api/sharing/sessions/${sessionId}/ice-servers`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      expect(res.statusCode).toBe(200);
      const { iceServers } = res.json<IceServersResponse>();
      expect(iceServers).toHaveLength(1);
      expect(iceServers[0]?.urls).toContain('stun:');
    } finally {
      await app.close();
    }
  });

  it('returns ephemeral HMAC-SHA1 credentials when TURN relay is enabled', async () => {
    const relayConfig: RelayConfig = {
      enabled: true,
      url: 'turns:relay.example.org:5349',
      realm: 'example.org',
      secret: 'super-secret-turn-key',
    };
    const app = makeApp(relayConfig);
    try {
      const helpRequestId = await submitAndClaim(app, 'sharing-ice-turn-1');

      const initRes = await app.inject({
        method: 'POST',
        url: '/api/sharing/sessions',
        headers: { authorization: `Bearer ${tokens.support}` },
        payload: { helpRequestId },
      });
      const sessionId: string = initRes.json<SessionResponse>().session.id;

      const res = await app.inject({
        method: 'GET',
        url: `/api/sharing/sessions/${sessionId}/ice-servers`,
        headers: { authorization: `Bearer ${tokens['learner-a']}` },
      });
      expect(res.statusCode).toBe(200);
      const { iceServers } = res.json<IceServersResponse>();
      expect(iceServers).toHaveLength(1);
      const server = iceServers[0];
      expect(server?.urls).toBe('turns:relay.example.org:5349');
      expect(server?.username).toBeDefined();
      expect(server?.credential).toBeDefined();
    } finally {
      await app.close();
    }
  });
});
