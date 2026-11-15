// PostgreSQL implementation for employer vacancies and consented candidate applications (T3-031).
import type pg from 'pg';
import type {
  ConsentedApplication,
  CreateVacancyInput,
  EmployerVacancy,
} from '../domain/employer.ts';
import type { EmployerRepository } from '../application/ports/employer-repository.ts';

interface VacancyRow {
  id: string;
  employer_id: string;
  title: string;
  description: string;
  category: string;
  location: string;
  status: 'draft' | 'active' | 'archived';
  created_at: Date;
  expires_at: Date;
}

interface ApplicationRow {
  id: string;
  vacancy_id: string;
  learner_id: string;
  learner_full_name: string;
  contact_channel: string;
  resume_url: string | null;
  status: 'submitted' | 'under_review' | 'interview_scheduled' | 'closed';
  consented_at: Date;
}

export class PostgresEmployerRepository implements EmployerRepository {
  readonly #pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  async createVacancy(employerId: string, input: CreateVacancyInput): Promise<EmployerVacancy> {
    const days = input.expiresDays ?? 30;
    const expiresAt = new Date(Date.now() + days * 86400000);

    const result = await this.#pool.query<VacancyRow>(
      `INSERT INTO employer_vacancies (employer_id, title, description, category, location, status, expires_at)
       VALUES ($1, $2, $3, $4, $5, 'active', $6)
       RETURNING id, employer_id, title, description, category, location, status, created_at, expires_at`,
      [employerId, input.title, input.description, input.category, input.location, expiresAt],
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error('Failed to insert vacancy');
    }
    return this.#mapVacancy(row);
  }

  async listVacancies(employerId: string): Promise<readonly EmployerVacancy[]> {
    const result = await this.#pool.query<VacancyRow>(
      `SELECT id, employer_id, title, description, category, location, status, created_at, expires_at
         FROM employer_vacancies
        WHERE employer_id = $1
        ORDER BY created_at DESC`,
      [employerId],
    );
    return result.rows.map((r) => this.#mapVacancy(r));
  }

  async getVacancy(employerId: string, vacancyId: string): Promise<EmployerVacancy | null> {
    const result = await this.#pool.query<VacancyRow>(
      `SELECT id, employer_id, title, description, category, location, status, created_at, expires_at
         FROM employer_vacancies
        WHERE id = $1 AND employer_id = $2`,
      [vacancyId, employerId],
    );
    const row = result.rows[0];
    return row ? this.#mapVacancy(row) : null;
  }

  async listApplications(
    employerId: string,
    vacancyId: string,
  ): Promise<readonly ConsentedApplication[] | null> {
    const vacancy = await this.getVacancy(employerId, vacancyId);
    if (!vacancy) return null;

    const result = await this.#pool.query<ApplicationRow>(
      `SELECT id, vacancy_id, learner_id, learner_full_name, contact_channel, resume_url, status, consented_at
         FROM consented_applications
        WHERE vacancy_id = $1
        ORDER BY consented_at DESC`,
      [vacancyId],
    );
    return result.rows.map((r) => this.#mapApplication(r));
  }

  async submitApplication(
    vacancyId: string,
    application: {
      learnerId: string;
      learnerFullName: string;
      contactChannel: string;
      resumeUrl?: string;
    },
  ): Promise<ConsentedApplication | null> {
    const result = await this.#pool.query<ApplicationRow>(
      `INSERT INTO consented_applications (vacancy_id, learner_id, learner_full_name, contact_channel, resume_url)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (vacancy_id, learner_id) DO NOTHING
       RETURNING id, vacancy_id, learner_id, learner_full_name, contact_channel, resume_url, status, consented_at`,
      [
        vacancyId,
        application.learnerId,
        application.learnerFullName,
        application.contactChannel,
        application.resumeUrl ?? null,
      ],
    );
    const row = result.rows[0];
    return row ? this.#mapApplication(row) : null;
  }

  #mapVacancy(row: VacancyRow): EmployerVacancy {
    return {
      id: row.id,
      employerId: row.employer_id,
      title: row.title,
      description: row.description,
      category: row.category,
      location: row.location,
      status: row.status,
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
    };
  }

  #mapApplication(row: ApplicationRow): ConsentedApplication {
    return {
      id: row.id,
      vacancyId: row.vacancy_id,
      learnerId: row.learner_id,
      learnerFullName: row.learner_full_name,
      contactChannel: row.contact_channel,
      ...(row.resume_url ? { resumeUrl: row.resume_url } : {}),
      status: row.status,
      consentedAt: row.consented_at.toISOString(),
    };
  }
}
