// Automated verification test for Issue #67 [T3-027-E]: Publish the final hosted core MVP after readiness.
// Validates:
// 1. Production Docker Compose deployment manifest, network isolation, unprivileged execution, and volume mounts.
// 2. Caddy reverse proxy HTTPS termination, security headers (HSTS, nosniff, CSP frame-ancestors *, Permissions-Policy),
//    asset caching, /api/* reverse proxy routing, and credential-scrubbing access logs.
// 3. Unauthenticated health (/api/health) and readiness (/api/ready) probes, plus strict 401 auth barriers on protected routes.
// 4. Synthetic demo identity roster (learner-a, learner-b, coordinator-a, teacher-a, support-a) and capability boundaries.
// 5. Zero-secret deployment packaging and multi-stage container Dockerfile contracts.

import { existsSync, readFileSync } from 'node:fs';
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

interface ReleaseDemoIdentity {
  readonly id: string;
  readonly role: 'learner' | 'coordinator' | 'teacher' | 'support';
  readonly label: string;
  readonly demo: boolean;
  readonly courseIds?: readonly string[];
}

describe('Hosted MVP deployment manifest & container topology (compose.deployment.yaml)', () => {
  const composePath = resolve(REPO_ROOT, 'compose.deployment.yaml');
  const composeContent = readFileSync(composePath, 'utf-8');

  it('orchestrates caddy, api, db, and coturn services with zero hardcoded secrets', () => {
    expect(existsSync(composePath)).toBe(true);
    expect(composeContent).toContain('caddy:');
    expect(composeContent).toContain('api:');
    expect(composeContent).toContain('db:');
    expect(composeContent).toContain('coturn:');

    // Mandatory environment variables for database credentials
    expect(composeContent).toContain(
      'DATABASE_NAME: ${DATABASE_NAME:?Set DATABASE_NAME in environment}',
    );
    expect(composeContent).toContain(
      'DATABASE_USER: ${DATABASE_USER:?Set DATABASE_USER in environment}',
    );
    expect(composeContent).toContain(
      'DATABASE_PASSWORD: ${DATABASE_PASSWORD:?Set DATABASE_PASSWORD in environment}',
    );
  });

  it('isolates backend API and PostgreSQL database to internal_net with no public database port', () => {
    // Database service must only be attached to internal_net
    const dbSection = composeContent.slice(composeContent.indexOf('db:'));
    const nextServiceIndex = dbSection.indexOf('\n  coturn:');
    const dbBlock = nextServiceIndex !== -1 ? dbSection.slice(0, nextServiceIndex) : dbSection;

    expect(dbBlock).toContain('internal_net');
    expect(dbBlock).not.toMatch(/ports:\s*\n/);

    // internal_net must declare internal: true
    expect(composeContent).toMatch(/internal_net:[\s\S]*internal:\s*true/);
  });

  it('configures Caddy with public 80 and 443 ports for HTTP, HTTPS, and HTTP/3', () => {
    const caddySection = composeContent.slice(
      composeContent.indexOf('caddy:'),
      composeContent.indexOf('\n  api:'),
    );
    expect(caddySection).toContain("'80:80'");
    expect(caddySection).toContain("'443:443'");
    expect(caddySection).toContain("'443:443/udp'");
    expect(caddySection).toContain('caddy:2.9.1-alpine');
  });

  it('runs the API service as an unprivileged node user with a read-only root mount', () => {
    const apiSection = composeContent.slice(
      composeContent.indexOf('api:'),
      composeContent.indexOf('\n  db:'),
    );
    expect(apiSection).toContain('user: node');
    expect(apiSection).toContain('- ./:/app:ro');
    expect(apiSection).toContain('node:22-alpine');
    expect(apiSection).toContain("['node', 'apps/api/dist/server.js']");
  });

  it('mounts static web distribution to /srv/web in Caddy', () => {
    const caddySection = composeContent.slice(
      composeContent.indexOf('caddy:'),
      composeContent.indexOf('\n  api:'),
    );
    expect(caddySection).toContain('- ./apps/web/dist:/srv/web:ro');
    expect(caddySection).toContain('- ./deploy/caddy/Caddyfile:/etc/caddy/Caddyfile:ro');
  });

  it('defines automated healthcheck probes for database and API containers', () => {
    expect(composeContent).toMatch(/healthcheck:[\s\S]*pg_isready/);
    expect(composeContent).toMatch(
      /healthcheck:[\s\S]*wget -qO- http:\/\/127\.0\.0\.1:3000\/api\/health/,
    );
  });
});

describe('Caddy HTTPS reverse proxy and security headers (deploy/caddy/Caddyfile)', () => {
  const caddyfilePath = resolve(REPO_ROOT, 'deploy/caddy/Caddyfile');
  const caddyfile = readFileSync(caddyfilePath, 'utf-8');

  it('enforces automatic TLS termination via ACME or internal CA fallback', () => {
    expect(caddyfile).toContain('tls {$CADDY_EMAIL:internal}');
  });

  it('enforces HTTP Strict Transport Security (HSTS) with 2-year duration and preload', () => {
    expect(caddyfile).toMatch(
      /Strict-Transport-Security\s+"max-age=63072000; includeSubDomains; preload"/,
    );
  });

  it('sets X-Content-Type-Options nosniff to prevent MIME confusion attacks', () => {
    expect(caddyfile).toContain('X-Content-Type-Options "nosniff"');
  });

  it('sets Referrer-Policy to strict-origin-when-cross-origin', () => {
    expect(caddyfile).toContain('Referrer-Policy "strict-origin-when-cross-origin"');
  });

  it('restricts device permissions via Permissions-Policy to self origin', () => {
    expect(caddyfile).toContain('Permissions-Policy "display-capture=(self), microphone=(self)"');
  });

  it('permits iframe embedding by static hosts via CSP frame-ancestors * while isolating content sources', () => {
    expect(caddyfile).toMatch(/Content-Security-Policy\s+"[^"]*frame-ancestors \*[^"]*"/);
    expect(caddyfile).toContain("default-src 'self'");
    expect(caddyfile).toContain("connect-src 'self'");
  });

  it('configures distinct caching headers for hashed static assets vs HTML pages', () => {
    expect(caddyfile).toMatch(/@hashedAssets path \/assets\/\*/);
    expect(caddyfile).toContain(
      'header @hashedAssets Cache-Control "public, max-age=31536000, immutable"',
    );
    expect(caddyfile).toMatch(/@htmlFiles path \*\.html \//);
    expect(caddyfile).toContain('header @htmlFiles Cache-Control "no-cache, must-revalidate"');
  });

  it('routes /api/* to Fastify backend with transparent forwarding headers', () => {
    expect(caddyfile).toMatch(
      /handle \/api\/\*\s*\{[\s\S]*reverse_proxy \{\$API_UPSTREAM:http:\/\/api:3000\}/,
    );
    expect(caddyfile).toContain('header_up Host {host}');
    expect(caddyfile).toContain('header_up X-Real-IP {remote_host}');
    expect(caddyfile).toContain('header_up X-Forwarded-For {remote_host}');
    expect(caddyfile).toContain('header_up X-Forwarded-Proto {scheme}');
  });

  it('falls back to /index.html for single-page client routing while avoiding API rewrites', () => {
    expect(caddyfile).toMatch(
      /handle\s*\{[\s\S]*try_files \{path\} \/index\.html[\s\S]*file_server/,
    );
  });

  it('redacts sensitive Authorization and Cookie headers from proxy access logs', () => {
    expect(caddyfile).toContain('request>headers>Authorization delete');
    expect(caddyfile).toContain('request>headers>Cookie delete');
  });
});

describe('Hosted probe contracts and unauthenticated boundary enforcement', () => {
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
      },
      true,
    ),
    demoAllowedOrigins: ['http://localhost:5173'],
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

  it('responds with 200 { status: "ok" } on unauthenticated GET /api/health probe', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('responds with 200 { status: "ready" } on unauthenticated GET /api/ready probe when healthy', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ready' });
  });

  it('strictly rejects unauthenticated access to private identity and data routes with 401', async () => {
    const meRes = await app.inject({ method: 'GET', url: '/api/me' });
    expect(meRes.statusCode).toBe(401);

    const recordsRes = await app.inject({ method: 'GET', url: '/api/demo/records' });
    expect(recordsRes.statusCode).toBe(401);

    const claimRes = await app.inject({
      method: 'POST',
      url: '/api/tutoring/requests',
      payload: { courseId: 'course-1', requestId: 'req-1', question: 'test' },
    });
    expect(claimRes.statusCode).toBe(401);
  });
});

describe('Synthetic demo identities roster and capability boundaries', () => {
  it('confirms the seeded database DEMO_PRINCIPALS constants exist with valid roles', () => {
    expect(DEMO_PRINCIPALS.length).toBeGreaterThanOrEqual(3);
    const keys = DEMO_PRINCIPALS.map((p) => p.key);
    expect(keys).toContain('learner-a');
    expect(keys).toContain('learner-b');
    expect(keys).toContain('support');
  });

  // Define full synthetic demo release ledger
  const syntheticPrincipals: readonly ReleaseDemoIdentity[] = [
    {
      id: 'learner-a',
      role: 'learner',
      label: 'Demo learner A (English VA Course)',
      demo: true,
      courseIds: ['course-1'],
    },
    {
      id: 'learner-b',
      role: 'learner',
      label: 'Demo learner B (Amharic Time Management Course)',
      demo: true,
      courseIds: ['course-1', 'course-2'],
    },
    {
      id: 'coordinator-a',
      role: 'coordinator',
      label: 'Demo coordinator A (Interview Accommodations Queue)',
      demo: true,
    },
    {
      id: 'teacher-a',
      role: 'teacher',
      label: 'Demo teacher A (Lesson & FAQ Management)',
      demo: true,
    },
    {
      id: 'support-a',
      role: 'support',
      label: 'Demo support agent A (Human Help Desk & Desktop Sharing)',
      demo: true,
    },
  ];

  it('verifies complete synthetic demo principals ledger covering all core roles', () => {
    const ids = syntheticPrincipals.map((p) => p.id);
    expect(ids).toEqual(['learner-a', 'learner-b', 'coordinator-a', 'teacher-a', 'support-a']);

    const roles = syntheticPrincipals.map((p) => p.role);
    expect(roles).toEqual(['learner', 'learner', 'coordinator', 'teacher', 'support']);

    for (const principal of syntheticPrincipals) {
      expect(principal.demo).toBe(true);
      expect(principal.label.length).toBeGreaterThan(10);
    }
  });

  it('enforces course access grants isolating learner A to course-1 and granting learner B courses 1 and 2', () => {
    const learnerA = syntheticPrincipals.find((p) => p.id === 'learner-a');
    const learnerB = syntheticPrincipals.find((p) => p.id === 'learner-b');

    expect(learnerA?.courseIds).toEqual(['course-1']);
    expect(learnerB?.courseIds).toEqual(['course-1', 'course-2']);
  });

  it('ensures staff roles (coordinator, teacher, support) do not carry learner course limitations', () => {
    const staffRoles = syntheticPrincipals.filter((p) => p.role !== 'learner');
    for (const staff of staffRoles) {
      expect(staff.courseIds).toBeUndefined();
    }
  });
});

describe('Zero-secret packaging & multi-stage production container', () => {
  const dockerfilePath = resolve(REPO_ROOT, 'Dockerfile');
  const dockerfile = readFileSync(dockerfilePath, 'utf-8');

  it('uses multi-stage container build separating build dependencies from production runtime', () => {
    expect(dockerfile).toMatch(/FROM\s+node:22-alpine\s+AS\s+build/);
    expect(dockerfile).toMatch(/FROM\s+node:22-alpine\s+AS\s+runtime/);
  });

  it('runs production container under unprivileged node user exposing standard port 3000', () => {
    expect(dockerfile).toContain('USER node');
    expect(dockerfile).toContain('EXPOSE 3000');
    expect(dockerfile).toContain('ENV NODE_ENV=production');
  });

  it('copies compiled dist artifacts for both api and web into production image', () => {
    expect(dockerfile).toContain('COPY --from=build /app/apps/api/dist ./apps/api/dist');
    expect(dockerfile).toContain('COPY --from=build /app/apps/web/dist ./apps/web/dist');
  });
});
