import { describe, expect, it } from 'vitest';
import { buildApp } from '../../bootstrap/app.ts';
import { ResolvePrincipal, digestToken } from '../identity/application/resolve-principal.ts';
import type { PrincipalRepository } from '../identity/application/principal-repository.ts';
import { EmployerService } from './application/employer-service.ts';
import type { EmployerRepository } from './application/ports/employer-repository.ts';
import type {
  ConsentedApplication,
  CreateVacancyInput,
  EmployerVacancy,
} from './domain/employer.ts';
import type { DemoRecords } from '../demo-records/demo-records.ts';
import type { DemoSessions } from '../identity/application/demo-sessions.ts';
import type { ContentAccess } from '../content/application/content-access.ts';
import type { Tutoring } from '../tutoring/application/tutoring.ts';
import type { Accommodation } from '../accommodation/application/accommodation.ts';

interface VacancyResponse {
  readonly id: string;
  readonly title: string;
  readonly location: string;
  readonly category: string;
  readonly requirements?: readonly string[];
}

interface VacanciesListResponse {
  readonly vacancies: readonly VacancyResponse[];
}

interface ApplicationsListResponse {
  readonly privacyNotice: string;
  readonly applications: readonly ConsentedApplication[];
}

class InMemoryEmployerRepository implements EmployerRepository {
  private vacancies: EmployerVacancy[] = [];
  private applications: ConsentedApplication[] = [];

  createVacancy(employerId: string, input: CreateVacancyInput): Promise<EmployerVacancy> {
    const vacancy: EmployerVacancy = {
      id: `vac-${this.vacancies.length + 1}`,
      employerId,
      title: input.title,
      description: input.description,
      category: input.category,
      location: input.location,
      status: 'active',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + (input.expiresDays ?? 30) * 86400000).toISOString(),
    };
    this.vacancies.push(vacancy);
    return Promise.resolve(vacancy);
  }

  listVacancies(employerId: string): Promise<readonly EmployerVacancy[]> {
    return Promise.resolve(this.vacancies.filter((v) => v.employerId === employerId));
  }

  getVacancy(employerId: string, vacancyId: string): Promise<EmployerVacancy | null> {
    return Promise.resolve(
      this.vacancies.find((v) => v.id === vacancyId && v.employerId === employerId) ?? null,
    );
  }

  async listApplications(
    employerId: string,
    vacancyId: string,
  ): Promise<readonly ConsentedApplication[] | null> {
    const vacancy = await this.getVacancy(employerId, vacancyId);
    if (!vacancy) return null;
    return this.applications.filter((a) => a.vacancyId === vacancyId);
  }

  submitApplication(
    vacancyId: string,
    application: {
      learnerId: string;
      learnerFullName: string;
      contactChannel: string;
      resumeUrl?: string;
    },
  ): Promise<ConsentedApplication | null> {
    const app: ConsentedApplication = {
      id: `app-${this.applications.length + 1}`,
      vacancyId,
      learnerId: application.learnerId,
      learnerFullName: application.learnerFullName,
      contactChannel: application.contactChannel,
      ...(application.resumeUrl ? { resumeUrl: application.resumeUrl } : {}),
      status: 'submitted',
      consentedAt: new Date().toISOString(),
    };
    this.applications.push(app);
    return Promise.resolve(app);
  }
}

describe('Employer Dashboard & Strict Privacy Boundaries', () => {
  const repo = new InMemoryEmployerRepository();
  const employerService = new EmployerService(repo);

  const employerToken = 'employer-test-token-valid-length-12345';
  const learnerToken = 'learner-test-token-valid-length-12345';

  const principalRepo: PrincipalRepository = {
    findDemoByTokenDigest: (digest: string) => {
      if (digest === digestToken(employerToken)) {
        return Promise.resolve({
          id: 'emp-1',
          label: 'Employer One',
          role: 'employer' as const,
          demo: true,
          courseIds: [],
        });
      }
      if (digest === digestToken(learnerToken)) {
        return Promise.resolve({
          id: 'lrn-1',
          label: 'Learner One',
          role: 'learner' as const,
          demo: true,
          courseIds: ['course-1'],
        });
      }
      return Promise.resolve(null);
    },
  };

  const resolvePrincipal = new ResolvePrincipal(principalRepo, true);

  const app = buildApp({
    checkReadiness: () =>
      Promise.resolve({
        ready: true,
      }),
    demoRecords: {
      list: () => Promise.resolve([]),
      get: () => Promise.resolve(null),
      upsert: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    } as unknown as DemoRecords,
    demoSessions: {
      create: () => Promise.resolve({ id: 's1' }),
      find: () => Promise.resolve(null),
      revoke: () => Promise.resolve(),
    } as unknown as DemoSessions,
    demoAllowedOrigins: [],
    content: {
      search: () => Promise.resolve([]),
      resolve: () => Promise.resolve({ kind: 'not_found' }),
    } as unknown as ContentAccess,
    resolvePrincipal,
    employerService,
    tutoring: {
      getConversations: () => Promise.resolve([]),
      requestTutoring: () => Promise.resolve({}),
    } as unknown as Tutoring,
    accommodation: {
      getPlan: () => Promise.resolve(null),
    } as unknown as Accommodation,
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/employer/vacancies',
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects learners attempting to access employer routes with 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/employer/vacancies',
      headers: {
        authorization: `Bearer ${learnerToken}`,
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows employers to post vacancies and retrieve them', async () => {
    const postRes = await app.inject({
      method: 'POST',
      url: '/api/employer/vacancies',
      headers: {
        authorization: `Bearer ${employerToken}`,
      },
      payload: {
        title: 'Junior Frontend Developer',
        description: 'Help build accessible interfaces.',
        category: 'Technology',
        location: 'Remote',
      },
    });

    expect(postRes.statusCode).toBe(201);
    const body = postRes.json<VacancyResponse>();
    expect(body.title).toBe('Junior Frontend Developer');
    expect(body.location).toBe('Remote');

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/employer/vacancies',
      headers: {
        authorization: `Bearer ${employerToken}`,
      },
    });

    expect(getRes.statusCode).toBe(200);
    const result = getRes.json<VacanciesListResponse>();
    expect(result.vacancies.length).toBe(1);
    expect(result.vacancies[0]?.id).toBe(body.id);
  });

  it('enforces privacy boundary: employers are strictly forbidden (403) from learner tutoring/help', async () => {
    const tutoringRes = await app.inject({
      method: 'POST',
      url: '/api/tutoring/requests',
      headers: {
        authorization: `Bearer ${employerToken}`,
      },
      payload: {
        lessonId: 'lesson-1',
        query: 'Private learner question',
      },
    });
    expect(tutoringRes.statusCode).toBe(403);
  });

  it('allows employers to view consented applicants with privacy disclaimer notice', async () => {
    const postRes = await app.inject({
      method: 'POST',
      url: '/api/employer/vacancies',
      headers: {
        authorization: `Bearer ${employerToken}`,
      },
      payload: {
        title: 'Backend Engineer',
        description: 'Node.js & Postgres',
      },
    });
    const vac = postRes.json<VacancyResponse>();

    // Submit an application
    await repo.submitApplication(vac.id, {
      learnerId: 'lrn-1',
      learnerFullName: 'Applicant One',
      contactChannel: 'applicant@example.com',
    });

    const appsRes = await app.inject({
      method: 'GET',
      url: `/api/employer/vacancies/${vac.id}/applications`,
      headers: {
        authorization: `Bearer ${employerToken}`,
      },
    });

    expect(appsRes.statusCode).toBe(200);
    const data = appsRes.json<ApplicationsListResponse>();
    expect(data.privacyNotice).toContain('consent');
    expect(Array.isArray(data.applications)).toBe(true);
    expect(data.applications.length).toBe(1);
    expect(data.applications[0]?.learnerFullName).toBe('Applicant One');
  });

  it('returns 404 when querying applications for a vacancy owned by someone else or non-existent', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/employer/vacancies/non-existent-id/applications',
      headers: {
        authorization: `Bearer ${employerToken}`,
      },
    });
    expect(res.statusCode).toBe(404);
  });
});
