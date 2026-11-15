// Employer recruitment portal API client (T3-031).
// Provides recruitment pipeline operations strictly isolated to employer role.

export interface EmployerVacancy {
  readonly id: string;
  readonly employerId: string;
  readonly title: string;
  readonly description: string;
  readonly category: string;
  readonly location: string;
  readonly status: 'draft' | 'active' | 'archived';
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface ConsentedApplication {
  readonly id: string;
  readonly vacancyId: string;
  readonly learnerId: string;
  readonly learnerFullName: string;
  readonly contactChannel: string;
  readonly resumeUrl?: string;
  readonly status: 'submitted' | 'under_review' | 'interview_scheduled' | 'closed';
  readonly consentedAt: string;
}

export interface PostVacancyRequest {
  readonly title: string;
  readonly description: string;
  readonly category?: string | undefined;
  readonly location?: string | undefined;
  readonly expiresDays?: number | undefined;
}

export interface ApplicationsResponse {
  readonly vacancyId: string;
  readonly applications: readonly ConsentedApplication[];
  readonly privacyNotice: string;
}

export class EmployerApi {
  readonly #sessionToken: string;

  constructor(sessionToken: string) {
    this.#sessionToken = sessionToken;
  }

  async listVacancies(): Promise<readonly EmployerVacancy[]> {
    const res = await fetch('/api/employer/vacancies', {
      headers: {
        authorization: `Bearer ${this.#sessionToken}`,
      },
    });
    if (!res.ok) {
      throw new Error(`Failed to list vacancies: ${res.statusText}`);
    }
    const data = (await res.json()) as { vacancies: readonly EmployerVacancy[] };
    return data.vacancies;
  }

  async postVacancy(data: PostVacancyRequest): Promise<EmployerVacancy> {
    const res = await fetch('/api/employer/vacancies', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.#sessionToken}`,
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      throw new Error(`Failed to post vacancy: ${res.statusText}`);
    }
    return (await res.json()) as EmployerVacancy;
  }

  async listApplications(vacancyId: string): Promise<ApplicationsResponse> {
    const res = await fetch(
      `/api/employer/vacancies/${encodeURIComponent(vacancyId)}/applications`,
      {
        headers: {
          authorization: `Bearer ${this.#sessionToken}`,
        },
      },
    );
    if (!res.ok) {
      throw new Error(`Failed to list applications: ${res.statusText}`);
    }
    return (await res.json()) as ApplicationsResponse;
  }
}
