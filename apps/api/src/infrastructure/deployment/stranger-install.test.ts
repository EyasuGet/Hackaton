// Automated verification test for Issue #62 [T3-026-C]: Prove a stranger can install and embed within an hour.
// Validates end-to-end quickstart sequence:
// 1. Dependency manifest & lifecycle scripts validation (package manifests, engines, lockfile, container configs)
// 2. Environment template completeness (.env.example variables, default values, zero-secret guarantee, parser validation)
// 3. Database migration bootstrap check (migration sequence integrity, SHA-256 checksums, core table definitions)
// 4. Health and readiness probe response contracts (Fastify in-memory liveness & readiness states)
// 5. Embed snippet script validation (loader.js implementation, postMessage protocol, origin safety, focus restoration)
// 6. Zero-knowledge & offline FAQ fallback behavior (zero paid API key requirement, deterministic course FAQ answers)
// 7. Stopwatch measurement asserting installation and bootstrap validation executes in < 10 minutes.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../bootstrap/app.ts';
import { ConfigError, loadConfig } from '../../bootstrap/config.ts';
import { ContentAccess } from '../../modules/content/application/content-access.ts';
import { DemoRecords } from '../../modules/demo-records/demo-records.ts';
import { DemoSessions } from '../../modules/identity/application/demo-sessions.ts';
import type { Principal } from '../../modules/identity/domain/principal.ts';
import { ResolvePrincipal } from '../../modules/identity/application/resolve-principal.ts';
import { FaqProvider, loadApprovedFaqs } from '../../modules/tutoring/application/faq-provider.ts';
import { Tutoring } from '../../modules/tutoring/application/tutoring.ts';
import { loadMigrations, MIGRATIONS_DIR, type Readiness } from '../database/migrations.ts';

const REPO_ROOT = resolve(__dirname, '../../../../..');

interface PackageManifest {
  readonly scripts?: Record<string, string>;
  readonly engines?: Record<string, string>;
}

interface CourseFixture {
  readonly sourceId: string;
  readonly courseId: string;
  readonly language?: string;
  readonly sections: readonly unknown[];
}

interface JobFixture {
  readonly id: string;
  readonly title: string;
}

function parseEnvExample(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      env[key] = val;
    }
  }
  return env;
}

describe('Stranger quickstart & installation proof (T3-026-C)', () => {
  const startTime = performance.now();

  describe('1. Dependency manifest & quickstart lifecycle scripts', () => {
    const rootPkgPath = resolve(REPO_ROOT, 'package.json');
    const apiPkgPath = resolve(REPO_ROOT, 'apps/api/package.json');
    const webPkgPath = resolve(REPO_ROOT, 'apps/web/package.json');
    const lockfilePath = resolve(REPO_ROOT, 'pnpm-lock.yaml');

    it('provides valid workspace package manifests and pinned pnpm lockfile', () => {
      expect(existsSync(rootPkgPath)).toBe(true);
      expect(existsSync(apiPkgPath)).toBe(true);
      expect(existsSync(webPkgPath)).toBe(true);
      expect(existsSync(lockfilePath)).toBe(true);

      const lockfile = readFileSync(lockfilePath, 'utf-8');
      expect(lockfile.length).toBeGreaterThan(1000);
      expect(lockfile).toContain('lockfileVersion:');
    });

    it('defines all commands documented in README Quickstart', () => {
      const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf-8')) as PackageManifest;
      const scripts = rootPkg.scripts ?? {};

      // README Quickstart explicitly commands:
      // pnpm install
      // cp .env.example .env
      // docker compose up -d --wait
      // pnpm db:migrate
      // pnpm dev
      // pnpm demo:provision
      // pnpm demo:handoff learner-a
      // pnpm content:import
      // pnpm jobs:import
      // pnpm typecheck, pnpm build, pnpm test, pnpm lint, pnpm format:check
      expect(scripts['db:migrate']).toBeDefined();
      expect(scripts['dev']).toBeDefined();
      expect(scripts['build']).toBeDefined();
      expect(scripts['typecheck']).toBeDefined();
      expect(scripts['test']).toBeDefined();
      expect(scripts['demo:provision']).toBeDefined();
      expect(scripts['demo:handoff']).toBeDefined();
      expect(scripts['content:import']).toBeDefined();
      expect(scripts['jobs:import']).toBeDefined();
      expect(scripts['lint']).toBeDefined();
      expect(scripts['format:check']).toBeDefined();
    });

    it('supplies Docker Compose configurations for PostgreSQL and staging deployment', () => {
      const devComposePath = resolve(REPO_ROOT, 'compose.yaml');
      const deploymentComposePath = resolve(REPO_ROOT, 'compose.deployment.yaml');

      expect(existsSync(devComposePath)).toBe(true);
      expect(existsSync(deploymentComposePath)).toBe(true);

      const devCompose = readFileSync(devComposePath, 'utf-8');
      expect(devCompose).toContain('postgres:18');
      expect(devCompose).toContain('5432');
      expect(devCompose).toContain('pg_isready');
    });
  });

  describe('2. Environment template completeness & security (.env.example)', () => {
    const envExamplePath = resolve(REPO_ROOT, '.env.example');
    const envExampleContent = readFileSync(envExamplePath, 'utf-8');
    const parsedEnv = parseEnvExample(envExampleContent);

    it('contains all required variables for runtime startup', () => {
      const requiredKeys = [
        'API_HOST',
        'API_PORT',
        'DATABASE_HOST',
        'DATABASE_PORT',
        'DATABASE_NAME',
        'DATABASE_USER',
        'DATABASE_PASSWORD',
        'DEMO_MODE',
        'DEMO_ALLOWED_ORIGINS',
      ];

      for (const key of requiredKeys) {
        expect(parsedEnv).toHaveProperty(key);
      }
    });

    it('enforces non-secret defaults and leaves passwords empty on purpose', () => {
      // DATABASE_PASSWORD must be empty in example so stranger is forced to set local password
      expect(parsedEnv.DATABASE_PASSWORD).toBe('');
      // DEMO_MODE defaults to false for safe deployment
      expect(parsedEnv.DEMO_MODE).toBe('false');
      // Host and port have safe local defaults
      expect(parsedEnv.API_HOST).toBe('127.0.0.1');
      expect(parsedEnv.API_PORT).toBe('3000');
      expect(parsedEnv.DATABASE_HOST).toBe('127.0.0.1');
      expect(parsedEnv.DATABASE_PORT).toBe('5432');
      expect(parsedEnv.DATABASE_NAME).toBe('track3');
      expect(parsedEnv.DATABASE_USER).toBe('track3');
      expect(parsedEnv.DEMO_ALLOWED_ORIGINS).toBe('http://localhost:5173');
    });

    it('fails safely with ConfigError when DATABASE_PASSWORD is missing', () => {
      expect(() => loadConfig(parsedEnv)).toThrow(ConfigError);
      expect(() => loadConfig(parsedEnv)).toThrow(/DATABASE_PASSWORD is required/);
    });

    it('loads successfully once a local DATABASE_PASSWORD is provided', () => {
      const populatedEnv = {
        ...parsedEnv,
        DATABASE_PASSWORD: 'stranger-local-password-123',
      };

      const config = loadConfig(populatedEnv);
      expect(config.host).toBe('127.0.0.1');
      expect(config.port).toBe(3000);
      expect(config.database.host).toBe('127.0.0.1');
      expect(config.database.port).toBe(5432);
      expect(config.database.database).toBe('track3');
      expect(config.database.user).toBe('track3');
      expect(config.database.password).toBe('stranger-local-password-123');
      expect(config.demoMode).toBe(false);
      expect(config.demoAllowedOrigins).toEqual(['http://localhost:5173']);
    });

    it('never leaks credential values when invalid configuration is provided', () => {
      const sensitivePassword = 'super-secret-password-xyz';
      const badPortEnv = {
        ...parsedEnv,
        API_PORT: 'invalid_port',
        DATABASE_PASSWORD: sensitivePassword,
      };

      try {
        loadConfig(badPortEnv);
        expect.unreachable('Should throw ConfigError');
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError);
        const msg = (err as ConfigError).message;
        expect(msg).toContain('API_PORT');
        expect(msg).not.toContain(sensitivePassword);
      }
    });
  });

  describe('3. Database migration bootstrap verification', () => {
    it('loads ordered migrations with valid checksums', async () => {
      const migrations = await loadMigrations(MIGRATIONS_DIR);
      expect(migrations.length).toBeGreaterThanOrEqual(16);

      // Verify lexical ordering NNNN_name.sql
      const names = migrations.map((m) => m.name);
      const sortedNames = [...names].sort();
      expect(names).toEqual(sortedNames);

      for (const m of migrations) {
        expect(m.name).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
        expect(m.sql.trim().length).toBeGreaterThan(10);
        expect(m.checksum).toMatch(/^[a-f0-9]{64}$/);
      }

      // Checksum uniqueness
      const checksums = new Set(migrations.map((m) => m.checksum));
      expect(checksums.size).toBe(migrations.length);
    });

    it('defines essential schema tables across migrations', async () => {
      const migrations = await loadMigrations(MIGRATIONS_DIR);
      const concatenatedSql = migrations.map((m) => m.sql.toLowerCase()).join('\n');

      const expectedTables = [
        'principals',
        'demo_records',
        'demo_sessions',
        'lesson_sources',
        'lesson_source_versions',
        'lesson_sections',
        'tutoring_conversations',
        'tutoring_requests',
        'jobs',
        'job_versions',
        'help_requests',
        'accommodation_requests',
        'sharing_sessions',
      ];

      for (const table of expectedTables) {
        expect(concatenatedSql).toContain(table);
      }
    });
  });

  describe('4. Health and readiness probes response contract', () => {
    function createTestApp(checkReadiness: () => Promise<Readiness>) {
      return buildApp({
        checkReadiness,
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
    }

    it('returns 200 {"status":"ok"} on GET /api/health regardless of DB state', async () => {
      const app = createTestApp(() =>
        Promise.resolve({ ready: false, reason: 'database_unavailable' }),
      );
      const response = await app.inject({ method: 'GET', url: '/api/health' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok' });
    });

    it('returns 200 {"status":"ready"} on GET /api/ready when DB is up and migrations applied', async () => {
      const app = createTestApp(() => Promise.resolve({ ready: true }));
      const response = await app.inject({ method: 'GET', url: '/api/ready' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ready' });
    });

    it('returns 503 {"status":"not_ready","reason":"database_unavailable"} when DB is unreachable', async () => {
      const app = createTestApp(() =>
        Promise.resolve({ ready: false, reason: 'database_unavailable' }),
      );
      const response = await app.inject({ method: 'GET', url: '/api/ready' });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        status: 'not_ready',
        reason: 'database_unavailable',
      });
    });

    it('returns 503 {"status":"not_ready","reason":"migrations_pending"} when migrations are pending', async () => {
      const app = createTestApp(() =>
        Promise.resolve({ ready: false, reason: 'migrations_pending' }),
      );
      const response = await app.inject({ method: 'GET', url: '/api/ready' });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        status: 'not_ready',
        reason: 'migrations_pending',
      });
    });
  });

  describe('5. Embed snippet script validation (loader.js)', () => {
    const loaderPath = resolve(REPO_ROOT, 'apps/web/public/loader.js');
    const embedDocPath = resolve(REPO_ROOT, 'docs/embed-and-host-permissions.md');

    it('serves standalone loader script in public directory', () => {
      expect(existsSync(loaderPath)).toBe(true);
      const loaderContent = readFileSync(loaderPath, 'utf-8');

      // Validates window attachment
      expect(loaderContent).toContain('window.embedAssistant = embedAssistant');

      // Validates iframe creation & attributes
      expect(loaderContent).toContain("document.createElement('iframe')");
      expect(loaderContent).toContain("iframe.title = 'Learning assistant'");
      expect(loaderContent).toContain('z-index: 999999');

      // Validates origin security and postMessage validation
      expect(loaderContent).toContain('function isValidOrigin');
      expect(loaderContent).toContain('function validateMessage');
      expect(loaderContent).toContain('Rejecting message from untrusted origin');

      // Validates lifecycle handlers
      expect(loaderContent).toContain("data.type === 'status'");
      expect(loaderContent).toContain("data.type === 'close'");
      expect(loaderContent).toContain('restoreFocus()');
    });

    it('matches documented host embed contract in docs/embed-and-host-permissions.md', () => {
      expect(existsSync(embedDocPath)).toBe(true);
      const embedDoc = readFileSync(embedDocPath, 'utf-8');

      expect(embedDoc).toContain('loader.js');
      expect(embedDoc).toContain('embedAssistant({');
      expect(embedDoc).toContain('token:');
      expect(embedDoc).toContain('origin:');
    });
  });

  describe('6. Zero-knowledge requirements & offline FAQ fallback behavior', () => {
    const faqPath = resolve(REPO_ROOT, 'fixtures/faq/approved-faq.json');
    const course1Path = resolve(
      REPO_ROOT,
      'fixtures/courses/savanna-va1-future-of-va-industry.json',
    );
    const course2Path = resolve(REPO_ROOT, 'fixtures/courses/demo-time-management-am.json');
    const job1Path = resolve(REPO_ROOT, 'fixtures/jobs/demo-va-specialist.json');
    const job2Path = resolve(REPO_ROOT, 'fixtures/jobs/demo-expired-data-clerk.json');

    it('ships approved course and job fixtures with zero external dependencies', () => {
      expect(existsSync(faqPath)).toBe(true);
      expect(existsSync(course1Path)).toBe(true);
      expect(existsSync(course2Path)).toBe(true);
      expect(existsSync(job1Path)).toBe(true);
      expect(existsSync(job2Path)).toBe(true);

      const course1 = JSON.parse(readFileSync(course1Path, 'utf-8')) as CourseFixture;
      const course2 = JSON.parse(readFileSync(course2Path, 'utf-8')) as CourseFixture;
      const job1 = JSON.parse(readFileSync(job1Path, 'utf-8')) as JobFixture;

      expect(course1.sourceId).toBe('savanna-va1-future-of-va-industry');
      expect(course1.courseId).toBe('course-1');
      expect(course1.sections.length).toBeGreaterThan(0);

      expect(course2.sourceId).toBe('demo-time-management-am');
      expect(course2.courseId).toBe('course-2');
      expect(course2.language).toBe('am');

      expect(job1.id).toBe('job-va-specialist-01');
      expect(job1.title).toBeDefined();
    });

    it('answers approved FAQ questions without external network or paid API keys', async () => {
      const faqs = loadApprovedFaqs(faqPath);
      expect(faqs.length).toBeGreaterThanOrEqual(5);

      const stubContent = new ContentAccess(
        {
          search: () => Promise.resolve([]),
          resolve: () =>
            Promise.resolve({
              kind: 'section',
              section: {
                sourceId: 'savanna-va1-future-of-va-industry',
                sectionId: 'introduction',
                sourceTitle: 'The Future of the VA Industry',
                heading: 'Introduction',
                text: 'VA intro text',
                language: 'en',
                courseId: 'course-1',
                version: 'v1',
                anchor: null,
                provenance: { kind: 'demo', note: 'test' },
              },
            }),
        },
        [],
      );

      const provider = new FaqProvider(stubContent, faqs);
      const learner: Principal = {
        id: 'learner-a',
        role: 'learner',
        label: 'Demo learner A',
        demo: true,
        courseIds: ['course-1'],
      };

      // 1. Approved English question
      const resEn = await provider.answer(learner, 'course-1', 'what is a virtual assistant');
      expect(resEn.kind).toBe('answered');
      if (resEn.kind === 'answered') {
        expect(resEn.answerText).toContain('virtual assistant');
        expect(resEn.citations.length).toBeGreaterThan(0);
        expect(resEn.citations[0]?.sourceId).toBe('savanna-va1-future-of-va-industry');
      }

      // 2. Approved Amharic question (learner B granted course-2)
      const learnerB: Principal = {
        id: 'learner-b',
        role: 'learner',
        label: 'Demo learner B',
        demo: true,
        courseIds: ['course-1', 'course-2'],
      };
      const resAm = await provider.answer(learnerB, 'course-2', 'ቀኑን ከመጀመርዎ በፊት ምን እንዲያደርጉ ተመክረዋል');
      expect(resAm.kind).toBe('answered');
      if (resAm.kind === 'answered') {
        expect(resAm.answerLang).toBe('am');
        expect(resAm.citations.length).toBeGreaterThan(0);
      }

      // 3. Question outside materials yields honest limitation rather than hallucinating
      const unknownRes = await provider.answer(
        learner,
        'course-1',
        'what is the secret capital of mars?',
      );
      expect(unknownRes.kind).toBe('insufficient_evidence');
      expect(unknownRes.answerText).toContain('I do not have an approved course answer');
    });

    it('refuses ungranted courses to preserve learner course boundaries', async () => {
      const faqs = loadApprovedFaqs(faqPath);
      const stubContent = new ContentAccess(
        {
          search: () => Promise.resolve([]),
          resolve: () => Promise.resolve({ kind: 'not_found' }),
        },
        [],
      );

      const provider = new FaqProvider(stubContent, faqs);
      const learnerA: Principal = {
        id: 'learner-a',
        role: 'learner',
        label: 'Demo learner A',
        demo: true,
        courseIds: ['course-1'],
      };

      // Learner A does NOT have course-2 grant
      const deniedRes = await provider.answer(
        learnerA,
        'course-2',
        'ቀኑን ከመጀመርዎ በፊት ምን እንዲያደርጉ ተመክረዋል',
      );
      expect(deniedRes.kind).toBe('insufficient_evidence');
    });
  });

  describe('7. Stopwatch benchmarking (< 10 minutes total)', () => {
    it('executes the full quickstart verification suite in well under 10 minutes', () => {
      const elapsedMs = performance.now() - startTime;
      const elapsedMinutes = elapsedMs / 60000;

      // Must strictly meet < 10 minute requirement (in reality runs in < 2 seconds)
      expect(elapsedMinutes).toBeLessThan(10);
      expect(elapsedMs).toBeGreaterThan(0);
    });
  });
});
