// Unit and route tests for schema.org JobPosting Level 3 integration (T3-044 / #216).
// Verifies schema.org JSON-LD parsing, normalization, idempotent ingestion,
// GET /api/jobs/:id content negotiation (application/ld+json vs standard JSON),
// and cited Q&A answerability with accommodations.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../bootstrap/app.ts';
import { ResolvePrincipal, digestToken } from '../identity/application/resolve-principal.ts';
import type { Principal } from '../identity/domain/principal.ts';
import {
  ImportJobs,
  type JobImportOutcome,
  type JobRepository,
} from './application/import-jobs.ts';
import { JobAnswers } from './application/job-answers.ts';
import { parseJobFile, type Job, type JobRecord } from './domain/job.ts';
import {
  isSchemaOrgJobPosting,
  parseSchemaOrgJobPosting,
  type SchemaOrgJobPosting,
} from './domain/schema-org-job-posting.ts';

const FIXTURE_PATH = fileURLToPath(
  new URL('../../../../../fixtures/jobs/partner-schema-org-job.json', import.meta.url),
);

const LEARNER_PRINCIPAL: Principal = {
  id: 'learner-user-01',
  role: 'learner',
  courseIds: ['course-01'],
  label: 'Learner User',
  demo: false,
};

const TEACHER_PRINCIPAL: Principal = {
  id: 'teacher-user-01',
  role: 'teacher',
  courseIds: ['course-01'],
  label: 'Teacher User',
  demo: false,
};

/** In-memory mock JobRepository for fast unit & route tests. */
class InMemoryJobRepository implements JobRepository {
  readonly jobs = new Map<string, JobRecord>();
  readonly checksums = new Map<string, string>();

  importJob(job: Job, checksum: string): Promise<JobImportOutcome> {
    const existing = this.jobs.get(job.id);
    const existingChecksum = this.checksums.get(job.id);

    if (existing && existingChecksum === checksum) {
      return Promise.resolve({
        id: job.id,
        status: 'unchanged',
        isNewPublication: false,
        publicationId: existing.publicationId,
        version: existing.version,
      });
    }

    const publicationId = existing?.publicationId ?? 'pub-00000000-0000-0000-0000-000000000001';
    const isNew = !existing;
    const record: JobRecord = {
      ...job,
      publicationId,
      status: job.withdrawn ? 'withdrawn' : 'active',
      isDemo: job.provenance.kind === 'demo',
      importedAt: new Date(),
    };

    this.jobs.set(job.id, record);
    this.checksums.set(job.id, checksum);

    return Promise.resolve({
      id: job.id,
      status: isNew ? 'imported' : 'updated',
      isNewPublication: isNew,
      publicationId,
      version: job.version,
    });
  }

  getJob(id: string): Promise<JobRecord | null> {
    return Promise.resolve(this.jobs.get(id) ?? null);
  }

  listJobs(): Promise<JobRecord[]> {
    return Promise.resolve(Array.from(this.jobs.values()));
  }

  getPublicationEvent(
    publicationId: string,
  ): Promise<{ publicationId: string; jobId: string; createdAt: Date } | null> {
    for (const [id, job] of this.jobs.entries()) {
      if (job.publicationId === publicationId) {
        return Promise.resolve({ publicationId, jobId: id, createdAt: job.importedAt });
      }
    }
    return Promise.resolve(null);
  }
}

describe('schema.org JobPosting Integration (T3-044 / #216)', () => {
  let sampleFixture: Record<string, unknown>;

  beforeAll(async () => {
    sampleFixture = JSON.parse(await readFile(FIXTURE_PATH, 'utf8')) as Record<string, unknown>;
  });

  describe('1. schema.org JobPosting JSON-LD Detection and Normalization', () => {
    it('recognizes schema.org JobPosting JSON-LD documents', () => {
      expect(isSchemaOrgJobPosting(sampleFixture)).toBe(true);
      expect(
        isSchemaOrgJobPosting({ '@type': 'JobPosting', '@context': 'http://schema.org' }),
      ).toBe(true);
      expect(
        isSchemaOrgJobPosting({ '@type': ['JobPosting'], '@context': 'https://schema.org' }),
      ).toBe(true);
      expect(isSchemaOrgJobPosting({ id: 'job-1', title: 'Test' })).toBe(false);
      expect(isSchemaOrgJobPosting(null)).toBe(false);
    });

    it('extracts all required and extended fields from schema.org JobPosting JSON-LD', () => {
      const result = parseSchemaOrgJobPosting(sampleFixture);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const { job } = result;
      expect(job.id).toBe('job-addis-software-engineer-01');
      expect(job.title).toBe('Junior Software Engineer');
      expect(job.organization).toBe('Addis Software Solutions');
      expect(job.location).toBe('Addis Ababa, Addis Ababa, ET');
      expect(job.category).toBe('software-engineering');
      expect(job.employmentType).toBe('FULL_TIME');
      expect(job.accessibilityNotes).toContain('Screen reader accessible tools');
      expect(job.description).toContain('TypeScript and React');
      expect(job.description).toContain('Accessibility & Accommodations');
      expect(job.postedAt.toISOString()).toBe('2026-11-01T08:00:00.000Z');
      expect(job.expiresAt.toISOString()).toBe('2026-12-31T23:59:59.000Z');
      expect(job.sourceUrl).toBe('https://addissoftware.et/careers/junior-software-engineer');
      expect(job.provenance.kind).toBe('partner');
      if (job.provenance.kind === 'partner') {
        expect(job.provenance.source).toBe('Addis Software Solutions');
      }
    });

    it('handles varied jobLocation formats (string, object with name, postal address)', () => {
      // 1. String location
      const withStringLoc = { ...sampleFixture, jobLocation: 'Hawassa, Ethiopia' };
      const res1 = parseSchemaOrgJobPosting(withStringLoc);
      expect(res1.ok).toBe(true);
      if (res1.ok) expect(res1.job.location).toBe('Hawassa, Ethiopia');

      // 2. Object with name
      const withNameLoc = {
        ...sampleFixture,
        jobLocation: { '@type': 'Place', name: 'Dire Dawa' },
      };
      const res2 = parseSchemaOrgJobPosting(withNameLoc);
      expect(res2.ok).toBe(true);
      if (res2.ok) expect(res2.job.location).toBe('Dire Dawa');

      // 3. Object with single address string
      const withAddressString = { ...sampleFixture, jobLocation: { address: 'Bahir Dar' } };
      const res3 = parseSchemaOrgJobPosting(withAddressString);
      expect(res3.ok).toBe(true);
      if (res3.ok) expect(res3.job.location).toBe('Bahir Dar');
    });

    it('extracts accommodations from multiple schema.org candidate fields', () => {
      const withSensory = {
        ...sampleFixture,
        accessibilityRequirements: undefined,
        sensoryRequirement: 'Visual or screen reader access',
        physicalRequirement: 'Light keyboard typing',
      };
      const result = parseSchemaOrgJobPosting(withSensory);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.job.accessibilityNotes).toBe(
          'Visual or screen reader access; Light keyboard typing',
        );
      }
    });

    it('parses JSON-LD @graph structure containing JobPosting items', () => {
      const graph = {
        '@context': 'https://schema.org',
        '@graph': [sampleFixture],
      };
      const result = parseJobFile(graph);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.jobs).toHaveLength(1);
        expect(result.jobs[0]?.id).toBe('job-addis-software-engineer-01');
      }
    });

    it('reports all validation errors on malformed schema.org input', () => {
      const invalid = {
        '@context': 'https://schema.org',
        '@type': 'JobPosting',
        // missing title, description, datePosted, validThrough, hiringOrganization
      };
      const result = parseSchemaOrgJobPosting(invalid);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((e) => e.includes('title'))).toBe(true);
        expect(result.errors.some((e) => e.includes('description'))).toBe(true);
        expect(result.errors.some((e) => e.includes('datePosted'))).toBe(true);
        expect(result.errors.some((e) => e.includes('validThrough'))).toBe(true);
        expect(result.errors.some((e) => e.includes('hiringOrganization'))).toBe(true);
      }
    });
  });

  describe('2. Ingestion & Idempotent Versioning', () => {
    it('imports schema.org JobPosting via ImportJobs and handles idempotent reimports', async () => {
      const repo = new InMemoryJobRepository();
      const importer = new ImportJobs(repo);

      // 1. Initial import
      const outcomes1 = await importer.execute(sampleFixture);
      expect(outcomes1).toHaveLength(1);
      expect(outcomes1[0]?.status).toBe('imported');
      expect(outcomes1[0]?.isNewPublication).toBe(true);

      const saved = await repo.getJob('job-addis-software-engineer-01');
      expect(saved).not.toBeNull();
      expect(saved?.employmentType).toBe('FULL_TIME');
      expect(saved?.accessibilityNotes).toContain('Screen reader accessible tools');

      // 2. Re-import identical schema.org content -> unchanged
      const outcomes2 = await importer.execute(sampleFixture);
      expect(outcomes2).toHaveLength(1);
      expect(outcomes2[0]?.status).toBe('unchanged');
      expect(outcomes2[0]?.isNewPublication).toBe(false);
      expect(outcomes2[0]?.publicationId).toBe(outcomes1[0]?.publicationId);
    });
  });

  describe('3. GET /api/jobs/:id Route and Content Negotiation', () => {
    let app: FastifyInstance;
    let repo: InMemoryJobRepository;

    beforeAll(async () => {
      repo = new InMemoryJobRepository();
      const importer = new ImportJobs(repo);
      await importer.execute(sampleFixture);

      const learnerToken = 'demo-learner-token-12345';
      const teacherToken = 'demo-teacher-token-12345';
      const learnerDigest = digestToken(learnerToken);
      const teacherDigest = digestToken(teacherToken);

      const resolvePrincipal = new ResolvePrincipal(
        {
          findDemoByTokenDigest: (digest) => {
            if (digest === learnerDigest) return Promise.resolve(LEARNER_PRINCIPAL);
            if (digest === teacherDigest) return Promise.resolve(TEACHER_PRINCIPAL);
            return Promise.resolve(null);
          },
        },
        true,
      );

      const dummy = new Proxy({}, { get: () => () => Promise.resolve({}) });

      app = buildApp({
        checkReadiness: () => Promise.resolve({ ready: true }),
        resolvePrincipal,
        jobRepository: repo,
        demoRecords: dummy as never,
        demoSessions: dummy as never,
        demoAllowedOrigins: ['http://localhost:5173'],
        tutoring: dummy as never,
        content: dummy as never,
        help: dummy as never,
        staffHelp: dummy as never,
        sharing: dummy as never,
        accommodation: dummy as never,
      });

      await app.ready();
    });

    afterAll(async () => {
      if (app) await app.close();
    });

    it('returns schema.org JobPosting JSON-LD when Accept: application/ld+json is sent', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/jobs/job-addis-software-engineer-01',
        headers: {
          authorization: 'Bearer demo-learner-token-12345',
          accept: 'application/ld+json',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('application/ld+json');

      const body = response.json<SchemaOrgJobPosting>();
      expect(body['@context']).toBe('https://schema.org');
      expect(body['@type']).toBe('JobPosting');
      expect(body.identifier).toBe('job-addis-software-engineer-01');
      expect(body.title).toBe('Junior Software Engineer');
      expect(body.hiringOrganization).toMatchObject({
        '@type': 'Organization',
        name: 'Addis Software Solutions',
      });
      expect(body.jobLocation).toMatchObject({
        '@type': 'Place',
        address: {
          '@type': 'PostalAddress',
          addressLocality: 'Addis Ababa, Addis Ababa, ET',
        },
      });
      expect(body.employmentType).toBe('FULL_TIME');
      expect(body.accessibilityRequirements).toContain('Screen reader accessible tools');
      expect(body.occupationalCategory).toBe('software-engineering');
    });

    it('returns standard JSON when Accept: application/json or default is requested', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/jobs/job-addis-software-engineer-01',
        headers: {
          authorization: 'Bearer demo-learner-token-12345',
          accept: 'application/json',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('application/json');

      const body = response.json<Record<string, unknown>>();
      expect(body.id).toBe('job-addis-software-engineer-01');
      expect(body.title).toBe('Junior Software Engineer');
      expect(body.organization).toBe('Addis Software Solutions');
      expect(body.category).toBe('software-engineering');
      expect(body.location).toBe('Addis Ababa, Addis Ababa, ET');
      expect(body.status).toBe('active');
      expect(body.employmentType).toBe('FULL_TIME');
      expect(body.accessibilityNotes).toContain('Screen reader accessible tools');
    });

    it('returns 404 Not Found for non-existent job ID', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/jobs/non-existent-job-99',
        headers: {
          authorization: 'Bearer demo-learner-token-12345',
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'not_found' });
    });

    it('returns 401 Unauthenticated when token is omitted', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/jobs/job-addis-software-engineer-01',
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'unauthenticated' });
    });

    it('returns 403 Forbidden when accessed by non-learner', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/jobs/job-addis-software-engineer-01',
        headers: {
          authorization: 'Bearer demo-teacher-token-12345',
        },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: 'forbidden' });
    });
  });

  describe('4. Grounded Career Q&A with Citations for Imported Jobs', () => {
    let repo: InMemoryJobRepository;
    let answers: JobAnswers;

    beforeAll(async () => {
      repo = new InMemoryJobRepository();
      const importer = new ImportJobs(repo);
      await importer.execute(sampleFixture);
      answers = new JobAnswers(repo);
    });

    it('answers questions about requirements with citations to imported schema.org job', async () => {
      const result = await answers.answer(
        LEARNER_PRINCIPAL,
        'What are the requirements for Junior Software Engineer at Addis Software Solutions?',
      );

      expect(result.kind).toBe('answered');
      expect(result.answerLang).toBe('en');
      expect(result.matchedJobId).toBe('job-addis-software-engineer-01');
      expect(result.answerText).toContain('Requirements for Junior Software Engineer');
      expect(result.answerText).toContain('TypeScript and React');
      expect(result.citations).toHaveLength(1);
      expect(result.citations[0]?.sourceId).toBe('job-addis-software-engineer-01');
      expect(result.citations[0]?.sourceTitle).toBe(
        'Addis Software Solutions — Junior Software Engineer',
      );
      expect(result.citations[0]?.url).toBe(
        'https://addissoftware.et/careers/junior-software-engineer',
      );
    });

    it('answers questions about accommodations with citations to imported schema.org job', async () => {
      const result = await answers.answer(
        LEARNER_PRINCIPAL,
        'What accommodations and accessibility support does Addis Software Solutions offer for Junior Software Engineer?',
      );

      expect(result.kind).toBe('answered');
      expect(result.matchedJobId).toBe('job-addis-software-engineer-01');
      expect(result.answerText).toContain('Screen reader accessible tools');
      expect(result.citations).toHaveLength(1);
      expect(result.citations[0]?.sourceId).toBe('job-addis-software-engineer-01');
    });

    it('answers in Amharic when query is in Amharic', async () => {
      const result = await answers.answer(
        LEARNER_PRINCIPAL,
        'በአዲስ ሶፍትዌር ውስጥ ለሶፍትዌር ኢንጂነር ምን ዓይነት ማስተናገጃ ወይም ተደራሽነት አለ?',
      );

      expect(result.kind).toBe('answered');
      expect(result.answerLang).toBe('am');
      expect(result.matchedJobId).toBe('job-addis-software-engineer-01');
      expect(result.answerText).toContain('ተደራሽነት/ማስተናገጃ');
      expect(result.citations).toHaveLength(1);
      expect(result.citations[0]?.sourceId).toBe('job-addis-software-engineer-01');
    });
  });
});
