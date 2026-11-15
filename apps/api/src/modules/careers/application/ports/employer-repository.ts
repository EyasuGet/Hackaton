// Port for employer vacancies and consented application storage (T3-031).
import type {
  ConsentedApplication,
  CreateVacancyInput,
  EmployerVacancy,
} from '../../domain/employer.ts';

export interface EmployerRepository {
  createVacancy(employerId: string, input: CreateVacancyInput): Promise<EmployerVacancy>;
  listVacancies(employerId: string): Promise<readonly EmployerVacancy[]>;
  getVacancy(employerId: string, vacancyId: string): Promise<EmployerVacancy | null>;
  listApplications(
    employerId: string,
    vacancyId: string,
  ): Promise<readonly ConsentedApplication[] | null>;
  submitApplication(
    vacancyId: string,
    application: {
      learnerId: string;
      learnerFullName: string;
      contactChannel: string;
      resumeUrl?: string;
    },
  ): Promise<ConsentedApplication | null>;
}
