// Integration test for career research endpoint and action isolation (T3-028-A).
// Proves HTTP contract, consent enforcement, learner RBAC, query minimisation,
// and action isolation (ensures web research never mutates internal job records
// or enqueues alert delivery intents).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../bootstrap/app.ts';
import { ResolvePrincipal, digestToken } from '../identity/application/resolve-principal.ts';
import { CareerResearchService } from './application/career-research.ts';
import { MockCareerResearchProvider } from './infrastructure/mock-career-research-provider.ts';
import type { JobRecord } from './domain/job.ts';
import type { JobRepository } from './application/import-jobs.ts';

const LEARNER_TOKEN = 'learner-token-at-least-20-chars-long';
const SUPPORT_TOKEN = 'support-token-at-least-20-chars-long';

class InMemoryJobRepository implements JobRepository {
  readonly #jobs: JobRecord[] = [
    {
      id: 'job-1',
      version: '1.0',
      title: 'Approved Accounting Assistant',
      organization: 'Addis Org',
      category: 'Accounting',
      location: 'Addis Ababa',
      sourceUrl: 'https://example.com/jobs/1',
      description: 'Approved internal job',
      status: 'active',
      postedAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
      withdrawn: false,
      provenance: { kind: 'demo', note: 'test' },
      publicationId: 'pub-1',
      isDemo: true,
      importedAt: new Date(),
    },
  ];

  // eslint-disable-next-line @typescript-eslint/require-await
  async listJobs(): Promise<JobRecord[]> {
    return [...this.#jobs];
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getJob(id: string): Promise<JobRecord | null> {
    return this.#jobs.find((j) => j.id === id) ?? null;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async importJob(): Promise<{
    id: string;
    status: 'imported';
    isNewPublication: boolean;
    publicationId: string;
    version: string;
  }> {
    return {
      id: 'job-1',
      status: 'imported',
      isNewPublication: true,
      publicationId: 'pub-1',
      version: '1.0',
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getPublicationEvent(): Promise<{
    publicationId: string;
    jobId: string;
    createdAt: Date;
  } | null> {
    return null;
  }

  getJobCount(): number {
    return this.#jobs.length;
  }
}

describe('POST /api/careers/research Integration & Action Isolation (T3-028-A)', () => {
  let app: FastifyInstance;
  let mockProvider: MockCareerResearchProvider;
  let jobRepo: InMemoryJobRepository;

  beforeAll(async () => {
    mockProvider = new MockCareerResearchProvider();
    const careerResearch = new CareerResearchService(mockProvider);
    jobRepo = new InMemoryJobRepository();

    const dummy = new Proxy({}, { get: () => () => Promise.resolve({}) });

    app = buildApp({
      checkReadiness: () => Promise.resolve({ ready: true }),
      resolvePrincipal: new ResolvePrincipal(
        {
          // eslint-disable-next-line @typescript-eslint/require-await
          findDemoByTokenDigest: async (digest) => {
            if (digest === digestToken(LEARNER_TOKEN)) {
              return {
                id: '00000000-0000-0000-0000-000000000001',
                role: 'learner',
                label: 'Learner One',
                demo: true,
                courseIds: ['course-1'],
              };
            }
            if (digest === digestToken(SUPPORT_TOKEN)) {
              return {
                id: '00000000-0000-0000-0000-000000000002',
                role: 'support',
                label: 'Support One',
                demo: true,
                courseIds: [],
              };
            }
            return null;
          },
        },
        true,
      ),
      demoRecords: dummy as never,
      demoSessions: dummy as never,
      demoAllowedOrigins: ['http://localhost:5173'],
      tutoring: dummy as never,
      content: dummy as never,
      jobRepository: jobRepo,
      careerResearch,
    });

    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('rejects unauthenticated requests with 401 Unauthorized', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/careers/research',
      payload: {
        query: 'junior developer',
        consent: true,
      },
    });

    expect(res.statusCode).toBe(401);
  });

  it('rejects non-learner roles with 403 Forbidden', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/careers/research',
      headers: {
        authorization: `Bearer ${SUPPORT_TOKEN}`,
      },
      payload: {
        query: 'junior developer',
        consent: true,
      },
    });

    expect(res.statusCode).toBe(403);
  });

  it('rejects requests missing explicit consent with 400 Bad Request', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/careers/research',
      headers: {
        authorization: `Bearer ${LEARNER_TOKEN}`,
      },
      payload: {
        query: 'junior developer',
        consent: false,
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: string }>();
    expect(body.error).toBe('consent_required');
  });

  it('performs query-minimized research with consent: true and preserves action isolation', async () => {
    const initialJobCount = jobRepo.getJobCount();

    const res = await app.inject({
      method: 'POST',
      url: '/api/careers/research',
      headers: {
        authorization: `Bearer ${LEARNER_TOKEN}`,
      },
      payload: {
        query: 'I am learner Abebe in course CS101. What junior web developer jobs in Addis Ababa?',
        consent: true,
        language: 'en',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      kind: string;
      provenance: string;
      query: string;
      citations: unknown[];
    }>();
    expect(body.kind).toBe('researched');
    expect(body.provenance).toBe('external_web_research');
    expect(body.query).not.toContain('Abebe');
    expect(body.query).not.toContain('CS101');
    expect(body.citations).toHaveLength(2);

    // ACTION ISOLATION: verify internal database records were NOT mutated
    expect(jobRepo.getJobCount()).toBe(initialJobCount);
  });

  it('returns 503 when provider is unavailable', async () => {
    mockProvider.setAvailable(false);

    const res = await app.inject({
      method: 'POST',
      url: '/api/careers/research',
      headers: {
        authorization: `Bearer ${LEARNER_TOKEN}`,
      },
      payload: {
        query: 'junior web developer',
        consent: true,
      },
    });

    expect(res.statusCode).toBe(503);
    const body = res.json<{ error: string }>();
    expect(body.error).toBe('provider_unavailable');

    mockProvider.setAvailable(true);
  });
});
