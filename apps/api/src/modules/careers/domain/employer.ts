// Domain models for employer recruitment dashboard and consented applications (T3-031).
// Enforces strict separation: employers can only manage their own vacancies and view
// applications from learners who explicitly consented by submitting.

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
  readonly resumeUrl?: string | undefined;
  readonly status: 'submitted' | 'under_review' | 'interview_scheduled' | 'closed';
  readonly consentedAt: string;
}

export interface CreateVacancyInput {
  readonly title: string;
  readonly description: string;
  readonly category: string;
  readonly location: string;
  readonly expiresDays?: number | undefined;
}
