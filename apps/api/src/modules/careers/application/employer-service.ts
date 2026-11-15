// Application service for employer vacancies and applicant review (T3-031).
import type {
  ConsentedApplication,
  CreateVacancyInput,
  EmployerVacancy,
} from '../domain/employer.ts';
import type { EmployerRepository } from './ports/employer-repository.ts';

export class EmployerService {
  readonly #repository: EmployerRepository;

  constructor(repository: EmployerRepository) {
    this.#repository = repository;
  }

  async postVacancy(employerId: string, input: CreateVacancyInput): Promise<EmployerVacancy> {
    if (!input.title || input.title.trim().length === 0) {
      throw new Error('Vacancy title is required');
    }
    if (!input.description || input.description.trim().length === 0) {
      throw new Error('Vacancy description is required');
    }
    return this.#repository.createVacancy(employerId, {
      title: input.title.trim(),
      description: input.description.trim(),
      category: input.category?.trim() || 'General',
      location: input.location?.trim() || 'Addis Ababa',
      expiresDays: input.expiresDays ?? 30,
    });
  }

  async getVacancies(employerId: string): Promise<readonly EmployerVacancy[]> {
    return this.#repository.listVacancies(employerId);
  }

  async getApplications(
    employerId: string,
    vacancyId: string,
  ): Promise<readonly ConsentedApplication[] | null> {
    return this.#repository.listApplications(employerId, vacancyId);
  }

  async applyToVacancy(
    vacancyId: string,
    application: {
      learnerId: string;
      learnerFullName: string;
      contactChannel: string;
      resumeUrl?: string;
    },
  ): Promise<ConsentedApplication | null> {
    return this.#repository.submitApplication(vacancyId, application);
  }
}
