// Automated verification probe for T3-018-D and T3-027-E deployment and relay configuration.
// Audits Caddy HTTPS reverse proxy headers, Coturn SSRF/relay guards, Compose network isolation,
// unprivileged execution, static asset caching, and public unauthenticated privacy boundaries.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../bootstrap/app.ts';
import { ContentAccess } from '../../modules/content/application/content-access.ts';
import { DemoRecords } from '../../modules/demo-records/demo-records.ts';
import { DemoSessions } from '../../modules/identity/application/demo-sessions.ts';
import { ResolvePrincipal } from '../../modules/identity/application/resolve-principal.ts';
import { DEMO_PRINCIPALS } from '../../modules/identity/infrastructure/postgres-principal-repository.ts';
import { Tutoring } from '../../modules/tutoring/application/tutoring.ts';

const REPO_ROOT = resolve(__dirname, '../../../../..');

describe('Caddyfile HTTPS reverse-proxy configuration', () => {
  const caddyfilePath = resolve(REPO_ROOT, 'deploy/caddy/Caddyfile');
  const caddyfile = readFileSync(caddyfilePath, 'utf-8');

  it('enforces automatic TLS termination via ACME or internal CA fallback', () => {
    expect(caddyfile).toContain('tls {$CADDY_EMAIL:internal}');
  });

  it('enforces HTTP Strict Transport Security (HSTS)', () => {
    expect(caddyfile).toMatch(/Strict-Transport-Security\s+"max-age=\d+;\s*includeSubDomains/i);
  });

  it('prevents MIME sniffing and limits referrer leakage', () => {
    expect(caddyfile).toContain('X-Content-Type-Options "nosniff"');
    expect(caddyfile).toContain('Referrer-Policy "strict-origin-when-cross-origin"');
  });

  it('grants display-capture permission to the application origin for screen sharing', () => {
    expect(caddyfile).toMatch(/Permissions-Policy\s+".*display-capture=\(self\)/i);
  });

  it('allows iframe embedding from static hosts while isolating script/connect sources', () => {
    expect(caddyfile).toMatch(/frame-ancestors\s+\*/);
    expect(caddyfile).toContain("default-src 'self'");
  });

  it('configures distinct caching headers for hashed static assets vs HTML pages', () => {
    expect(caddyfile).toMatch(/@hashedAssets path \/assets\/\*/);
    expect(caddyfile).toContain(
      'header @hashedAssets Cache-Control "public, max-age=31536000, immutable"',
    );
    expect(caddyfile).toMatch(/@htmlFiles path \*\.html \//);
    expect(caddyfile).toContain('header @htmlFiles Cache-Control "no-cache, must-revalidate"');
  });

  it('sanitises access logs to prevent token and cookie leakage', () => {
    expect(caddyfile).toContain('request>headers>Authorization delete');
    expect(caddyfile).toContain('request>headers>Cookie delete');
  });

  it('routes /api/* to Fastify upstream within a dedicated handle block to prevent try_files rewriting', () => {
    expect(caddyfile).toMatch(/handle\s+\/api\/\*\s*\{[\s\S]*reverse_proxy\s+\{\$API_UPSTREAM:/);
    expect(caddyfile).toMatch(/handle\s*\{[\s\S]*try_files\s+\{path\}\s+\/index\.html/);
  });
});

describe('Coturn TURN/STUN relay configuration', () => {
  const turnConfPath = resolve(REPO_ROOT, 'deploy/coturn/turnserver.conf');
  const turnConf = readFileSync(turnConfPath, 'utf-8');

  it('configures standard STUN/TURN listening ports', () => {
    expect(turnConf).toMatch(/^listening-port=3478/m);
    expect(turnConf).toMatch(/^tls-listening-port=5349/m);
    expect(turnConf).toMatch(/^min-port=\d+/m);
    expect(turnConf).toMatch(/^max-port=\d+/m);
  });

  it('uses ephemeral credentials with shared secret authentication', () => {
    expect(turnConf).toMatch(/^use-auth-secret/m);
    expect(turnConf).toMatch(/^fingerprint/m);
    // Never commit a static secret in the configuration file.
    expect(turnConf).not.toMatch(/^static-auth-secret=\S+/m);
  });

  it('disables CLI management and multicast relaying', () => {
    expect(turnConf).toMatch(/^no-cli/m);
    expect(turnConf).toMatch(/^no-multicast-peers/m);
  });

  it('enforces SSRF protection blocking private, loopback, and cloud-metadata IP ranges', () => {
    // Loopback
    expect(turnConf).toContain('denied-peer-ip=127.0.0.0-127.255.255.255');
    expect(turnConf).toContain('denied-peer-ip=::1');
    // RFC 1918 Private ranges
    expect(turnConf).toContain('denied-peer-ip=10.0.0.0-10.255.255.255');
    expect(turnConf).toContain('denied-peer-ip=172.16.0.0-172.31.255.255');
    expect(turnConf).toContain('denied-peer-ip=192.168.0.0-192.168.255.255');
    // Cloud metadata service (169.254.169.254)
    expect(turnConf).toContain('denied-peer-ip=169.254.0.0-169.254.255.255');
  });
});

describe('Compose deployment configuration', () => {
  const composePath = resolve(REPO_ROOT, 'compose.deployment.yaml');
  const compose = readFileSync(composePath, 'utf-8');

  it('isolates PostgreSQL to internal network with no exposed host ports', () => {
    const dbSection = compose.slice(compose.indexOf('db:'));
    const nextServiceIndex = dbSection.indexOf('\n  coturn:');
    const dbBlock = nextServiceIndex !== -1 ? dbSection.slice(0, nextServiceIndex) : dbSection;

    expect(dbBlock).toContain('internal_net');
    expect(dbBlock).not.toMatch(/\s+ports:\s*\n\s+-/);
  });

  it('requires mandatory database password from environment without defaults', () => {
    expect(compose).toMatch(/DATABASE_PASSWORD:\s+\$\{DATABASE_PASSWORD:\?Set DATABASE_PASSWORD/);
  });

  it('runs the API service as unprivileged node user with read-only root mount and static web mount in Caddy', () => {
    expect(compose).toContain('user: node');
    expect(compose).toContain('- ./:/app:ro');
    expect(compose).toContain('- ./apps/web/dist:/srv/web:ro');
  });

  it('includes service healthchecks for database and API', () => {
    expect(compose).toContain('pg_isready');
    expect(compose).toContain('/api/health');
  });
});

describe('Public unauthenticated request privacy boundary', () => {
  const app = buildApp({
    checkReadiness: () => Promise.resolve({ ready: true }),
    resolvePrincipal: new ResolvePrincipal(
      { findDemoByTokenDigest: () => Promise.resolve(null) },
      true,
    ),
    demoRecords: new DemoRecords({
      list: () => Promise.resolve([]),
      find: () => Promise.resolve(null),
    }),
    demoSessions: new DemoSessions(
      {
        createHandoff: () => Promise.resolve(false),
        consumeHandoff: () => Promise.resolve(null),
        createSession: () => Promise.resolve(),
        revokeSession: () => Promise.resolve(false),
        extendSession: () => Promise.resolve(false),
      },
      true,
    ),
    demoAllowedOrigins: [],
    tutoring: new Tutoring({
      createConversation: () => Promise.resolve(null),
      findConversation: () => Promise.resolve(null),
      claimRequest: () => Promise.resolve(null),
      findRequestById: () => Promise.resolve(null),
      findRequestByRequestId: () => Promise.resolve(null),
      listHistory: () => Promise.resolve([]),
      recordOutcome: () => Promise.resolve(null),
      clearHistory: () => Promise.resolve(),
      purgeExpired: () => Promise.resolve(0),
    }),
    content: new ContentAccess(
      {
        search: () => Promise.resolve([]),
        resolve: () => Promise.resolve({ kind: 'not_found' }),
      },
      [],
    ),
  });

  it('allows unauthenticated access to /api/health and /api/ready for proxy health checks', async () => {
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: 'ok' });

    const ready = await app.inject({ method: 'GET', url: '/api/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ status: 'ready' });
  });

  it('strictly rejects unauthenticated access to /api/me and demo records without token', async () => {
    const me = await app.inject({ method: 'GET', url: '/api/me' });
    expect(me.statusCode).toBe(401);

    const records = await app.inject({ method: 'GET', url: '/api/demo/records' });
    expect(records.statusCode).toBe(401);
  });

  it('strictly rejects unauthenticated tutoring claim request with 401', async () => {
    const claim = await app.inject({
      method: 'POST',
      url: '/api/tutoring/requests',
      payload: { courseId: 'course-1', requestId: 'req-1', question: 'test' },
    });
    expect(claim.statusCode).toBe(401);
  });
});

describe('Synthetic demo principal boundaries', () => {
  it('ensures seeded DEMO_PRINCIPALS isolate course grants and adhere to valid roles', () => {
    expect(DEMO_PRINCIPALS.length).toBeGreaterThanOrEqual(3);
    const learnerA = DEMO_PRINCIPALS.find((p) => p.key === 'learner-a');
    const learnerB = DEMO_PRINCIPALS.find((p) => p.key === 'learner-b');
    const support = DEMO_PRINCIPALS.find((p) => p.key === 'support');

    expect(learnerA).toBeDefined();
    expect(learnerA?.role).toBe('learner');
    expect(learnerA?.courseIds).toEqual(['course-1']);

    expect(learnerB).toBeDefined();
    expect(learnerB?.role).toBe('learner');
    expect(learnerB?.courseIds).toEqual(['course-1', 'course-2']);

    expect(support).toBeDefined();
    expect(support?.role).toBe('support');
    expect(support?.courseIds).toEqual([]);
  });
});
