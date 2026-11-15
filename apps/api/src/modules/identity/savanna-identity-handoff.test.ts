// Contract tests for real Savanna host identity handoff (T3-004-B).
// Asserts cryptographic signature verification, audience and issuer enforcement,
// strict expiration validation, single-use replay prevention via JTI cache,
// role validation, and integration with ResolvePrincipal.
import { describe, expect, it } from 'vitest';
import type { HandoffTokenPayload } from './domain/host-identity-adapter.ts';
import {
  createSignedHandoffToken,
  MemoryHostSessionStore,
  MemoryReplayCache,
  SavannaHostIdentityAdapter,
} from './infrastructure/savanna-host-identity-adapter.ts';
import { ResolvePrincipal } from './application/resolve-principal.ts';

const TEST_SECRET = 'super-secret-savanna-signing-key-for-test-32bytes!';
const TEST_ISSUER = 'https://savanna.alxafrica.com';
const TEST_AUDIENCE = 'https://assistant.alxafrica.com';
const ALLOWED_ORIGIN = 'http://localhost:5173';

function createAdapter(now: Date = new Date('2026-11-15T12:00:00Z')) {
  const replayCache = new MemoryReplayCache();
  const sessionStore = new MemoryHostSessionStore();
  const adapter = new SavannaHostIdentityAdapter(
    {
      secret: TEST_SECRET,
      issuer: TEST_ISSUER,
      audience: TEST_AUDIENCE,
      allowedAudiences: [ALLOWED_ORIGIN],
      clockToleranceMs: 60_000,
      sessionTtlMs: 2 * 60 * 60 * 1000, // 2 hours
    },
    {
      replayCache,
      sessionStore,
      now: () => now,
    },
  );
  return { adapter, replayCache, sessionStore };
}

function validPayload(overrides: Partial<HandoffTokenPayload> = {}): HandoffTokenPayload {
  return {
    sub: 'savanna_usr_abebe_001',
    name: 'Abebe Bikila',
    role: 'learner',
    course_ids: ['course-1', 'course-2'],
    iss: TEST_ISSUER,
    aud: TEST_AUDIENCE,
    exp: Math.floor(new Date('2026-11-15T12:15:00Z').getTime() / 1000), // +15m
    iat: Math.floor(new Date('2026-11-15T12:00:00Z').getTime() / 1000),
    jti: 'jti-nonce-uuid-12345',
    ...overrides,
  };
}

describe('SavannaHostIdentityAdapter Contract Verification (T3-004-B)', () => {
  it('validates a correct handoff token and derives production Principal and claims', async () => {
    const fixedNow = new Date('2026-11-15T12:00:00Z');
    const { adapter } = createAdapter(fixedNow);

    const payload = validPayload();
    const token = createSignedHandoffToken(payload, TEST_SECRET);

    const result = await adapter.validateHandoff(token);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.principal).toBeDefined();

    expect(result.principal).toEqual({
      id: 'savanna_usr_abebe_001',
      role: 'learner',
      label: 'Abebe Bikila',
      demo: false, // Must be false for production host identities
      courseIds: ['course-1', 'course-2'],
    });
  });

  it('exchanges a valid handoff token for an authenticated session', async () => {
    const fixedNow = new Date('2026-11-15T12:00:00Z');
    const { adapter } = createAdapter(fixedNow);

    const payload = validPayload({ jti: 'jti-exchange-test-1' });
    const token = createSignedHandoffToken(payload, TEST_SECRET);

    const exchange = await adapter.exchangeHandoff(token);
    expect(exchange.success).toBe(true);
    expect(exchange.error).toBeUndefined();
    expect(exchange.session).toBeDefined();
    expect(exchange.session?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(exchange.session?.expiresAt).toEqual(new Date('2026-11-15T14:00:00Z'));
    expect(exchange.principal?.demo).toBe(false);

    // Session can be resolved back to the Principal
    const resolved = await adapter.resolveSession(exchange.session!.token);
    expect(resolved).toEqual(exchange.principal);
  });

  it('resolves host sessions through ResolvePrincipal even when demo mode is off', async () => {
    const fixedNow = new Date('2026-11-15T12:00:00Z');
    const { adapter } = createAdapter(fixedNow);

    const payload = validPayload({ jti: 'jti-resolve-principal-1' });
    const token = createSignedHandoffToken(payload, TEST_SECRET);
    const exchange = await adapter.exchangeHandoff(token);

    // ResolvePrincipal with demoMode = false
    const dummyRepo = { findDemoByTokenDigest: () => Promise.resolve(null) };
    const resolvePrincipal = new ResolvePrincipal(dummyRepo, false, () => fixedNow, adapter);

    const principal = await resolvePrincipal.execute(exchange.session!.token);
    expect(principal).not.toBeNull();
    expect(principal?.id).toBe('savanna_usr_abebe_001');
    expect(principal?.demo).toBe(false);
  });

  it('strictly rejects expired tokens', async () => {
    const fixedNow = new Date('2026-11-15T12:00:00Z');
    const { adapter } = createAdapter(fixedNow);

    // Token expired 10 minutes ago
    const pastExp = Math.floor(new Date('2026-11-15T11:50:00Z').getTime() / 1000);
    const token = createSignedHandoffToken(
      validPayload({ exp: pastExp, jti: 'jti-exp-1' }),
      TEST_SECRET,
    );

    const result = await adapter.validateHandoff(token);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('token_expired');
    expect(result.principal).toBeUndefined();

    // Exchange also fails with token_expired
    const exchange = await adapter.exchangeHandoff(token);
    expect(exchange.success).toBe(false);
    expect(exchange.error).toBe('token_expired');
  });

  it('strictly rejects replayed tokens using the same JTI', async () => {
    const fixedNow = new Date('2026-11-15T12:00:00Z');
    const { adapter } = createAdapter(fixedNow);

    const token = createSignedHandoffToken(
      validPayload({ jti: 'unique-jti-nonce-replay-prevention' }),
      TEST_SECRET,
    );

    // First handoff succeeds
    const firstAttempt = await adapter.validateHandoff(token);
    expect(firstAttempt.valid).toBe(true);

    // Second handoff with the identical token / JTI is rejected as replayed
    const secondAttempt = await adapter.validateHandoff(token);
    expect(secondAttempt.valid).toBe(false);
    expect(secondAttempt.error).toBe('token_replayed');
    expect(secondAttempt.reason).toContain('has already been consumed');

    // Exchange also fails on replay
    const exchangeAttempt = await adapter.exchangeHandoff(token);
    expect(exchangeAttempt.success).toBe(false);
    expect(exchangeAttempt.error).toBe('token_replayed');
  });

  it('strictly rejects tokens with wrong audience', async () => {
    const fixedNow = new Date('2026-11-15T12:00:00Z');
    const { adapter } = createAdapter(fixedNow);

    const token = createSignedHandoffToken(
      validPayload({ aud: 'https://evil-unauthorized-app.com', jti: 'jti-aud-1' }),
      TEST_SECRET,
    );

    const result = await adapter.validateHandoff(token);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid_audience');
  });

  it('accepts tokens with allowed alternative audience origins', async () => {
    const fixedNow = new Date('2026-11-15T12:00:00Z');
    const { adapter } = createAdapter(fixedNow);

    // ALLOWED_ORIGIN ('http://localhost:5173') was configured in allowedAudiences
    const token = createSignedHandoffToken(
      validPayload({ aud: ALLOWED_ORIGIN, jti: 'jti-origin-1' }),
      TEST_SECRET,
    );

    const result = await adapter.validateHandoff(token);
    expect(result.valid).toBe(true);
    expect(result.principal?.id).toBe('savanna_usr_abebe_001');
  });

  it('strictly rejects tokens with wrong issuer', async () => {
    const fixedNow = new Date('2026-11-15T12:00:00Z');
    const { adapter } = createAdapter(fixedNow);

    const token = createSignedHandoffToken(
      validPayload({ iss: 'https://imposter-identity-provider.com', jti: 'jti-iss-1' }),
      TEST_SECRET,
    );

    const result = await adapter.validateHandoff(token);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid_issuer');
  });

  it('strictly rejects forged roles (privilege escalation attempts)', async () => {
    const fixedNow = new Date('2026-11-15T12:00:00Z');
    const { adapter } = createAdapter(fixedNow);

    // Attacker crafts a token with role: 'admin' or 'superadmin'
    const forgedAdminToken = createSignedHandoffToken(
      validPayload({ role: 'admin' as never, jti: 'jti-admin-1' }),
      TEST_SECRET,
    );
    const adminResult = await adapter.validateHandoff(forgedAdminToken);
    expect(adminResult.valid).toBe(false);
    expect(adminResult.error).toBe('invalid_role');

    const forgedSuperuserToken = createSignedHandoffToken(
      validPayload({ role: 'superuser' as never, jti: 'jti-root-1' }),
      TEST_SECRET,
    );
    const superuserResult = await adapter.validateHandoff(forgedSuperuserToken);
    expect(superuserResult.valid).toBe(false);
    expect(superuserResult.error).toBe('invalid_role');
  });

  it('correctly maps authorized support and teacher roles', async () => {
    const fixedNow = new Date('2026-11-15T12:00:00Z');
    const { adapter } = createAdapter(fixedNow);

    // Support role
    const supportToken = createSignedHandoffToken(
      validPayload({
        sub: 'savanna_staff_001',
        role: 'support',
        name: 'Sara Support',
        course_ids: [],
        jti: 'jti-support-1',
      }),
      TEST_SECRET,
    );
    const supportResult = await adapter.validateHandoff(supportToken);
    expect(supportResult.valid).toBe(true);
    expect(supportResult.principal?.role).toBe('support');
    expect(supportResult.principal?.courseIds).toEqual([]);

    // Teacher role
    const teacherToken = createSignedHandoffToken(
      validPayload({
        sub: 'savanna_teacher_001',
        role: 'teacher',
        name: 'Kebede Teacher',
        course_ids: ['course-1'],
        jti: 'jti-teacher-1',
      }),
      TEST_SECRET,
    );
    const teacherResult = await adapter.validateHandoff(teacherToken);
    expect(teacherResult.valid).toBe(true);
    expect(teacherResult.principal?.role).toBe('teacher');
    expect(teacherResult.principal?.courseIds).toEqual(['course-1']);
  });

  it('strictly rejects invalid or tampered signatures', async () => {
    const fixedNow = new Date('2026-11-15T12:00:00Z');
    const { adapter } = createAdapter(fixedNow);

    // Signed with wrong secret
    const wrongSecretToken = createSignedHandoffToken(
      validPayload({ jti: 'jti-sig-1' }),
      'wrong-attacker-secret-that-does-not-match!',
    );
    const wrongSigResult = await adapter.validateHandoff(wrongSecretToken);
    expect(wrongSigResult.valid).toBe(false);
    expect(wrongSigResult.error).toBe('invalid_signature');

    // Tampered payload
    const token = createSignedHandoffToken(validPayload({ jti: 'jti-sig-2' }), TEST_SECRET);
    const [h, , s] = token.split('.');
    const tamperedPayloadB64 = Buffer.from(
      JSON.stringify(validPayload({ role: 'teacher', jti: 'jti-sig-2' })),
    ).toString('base64url');
    const tamperedToken = `${h}.${tamperedPayloadB64}.${s}`;

    const tamperedResult = await adapter.validateHandoff(tamperedToken);
    expect(tamperedResult.valid).toBe(false);
    expect(tamperedResult.error).toBe('invalid_signature');
  });

  it('strictly rejects the alg: none signature bypass vulnerability', async () => {
    const fixedNow = new Date('2026-11-15T12:00:00Z');
    const { adapter } = createAdapter(fixedNow);

    const noneToken = createSignedHandoffToken(
      validPayload({ jti: 'jti-none-1' }),
      TEST_SECRET,
      'none',
    );
    const result = await adapter.validateHandoff(noneToken);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid_signature');
  });

  it('strictly rejects malformed tokens and missing claims', async () => {
    const fixedNow = new Date('2026-11-15T12:00:00Z');
    const { adapter } = createAdapter(fixedNow);

    // Empty string
    expect((await adapter.validateHandoff('')).error).toBe('missing_token');

    // Non-JWT string
    expect((await adapter.validateHandoff('not-a-jwt')).error).toBe('invalid_format');

    // 2 parts
    expect((await adapter.validateHandoff('header.payload')).error).toBe('invalid_format');

    // Missing sub claim
    const missingSub = createSignedHandoffToken(
      validPayload({ sub: '', jti: 'jti-missing-sub' }),
      TEST_SECRET,
    );
    expect((await adapter.validateHandoff(missingSub)).error).toBe('invalid_claims');

    // Non-array course_ids claim (e.g. wildcard grant injection)
    const invalidCourses = createSignedHandoffToken(
      validPayload({ course_ids: '*' as never, jti: 'jti-invalid-courses' }),
      TEST_SECRET,
    );
    expect((await adapter.validateHandoff(invalidCourses)).error).toBe('invalid_claims');
  });

  it('supports session revocation and expiry', async () => {
    const fixedNow = new Date('2026-11-15T12:00:00Z');
    const { adapter } = createAdapter(fixedNow);

    const token = createSignedHandoffToken(
      validPayload({ jti: 'jti-revocation-test' }),
      TEST_SECRET,
    );
    const exchange = await adapter.exchangeHandoff(token);
    expect(exchange.success).toBe(true);
    const sessionToken = exchange.session!.token;

    // Resolves before revocation
    expect(await adapter.resolveSession(sessionToken)).not.toBeNull();

    // Revocation succeeds
    const revoked = await adapter.revokeSession(sessionToken);
    expect(revoked).toBe(true);

    // Does not resolve after revocation
    expect(await adapter.resolveSession(sessionToken)).toBeNull();

    // Second revocation returns false
    expect(await adapter.revokeSession(sessionToken)).toBe(false);
  });
});
