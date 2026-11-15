import { describe, expect, it } from 'vitest';
import type { Principal } from '../../identity/domain/principal.ts';
import type { JobRecord } from '../domain/job.ts';
import type { JobRepository } from './import-jobs.ts';
import { JobAnswers } from './job-answers.ts';

const learnerPrincipal: Principal = {
  id: 'learner-1',
  role: 'learner',
  label: 'Learner One',
  demo: true,
  courseIds: ['course-1'],
};

const supportPrincipal: Principal = {
  id: 'staff-1',
  role: 'support',
  label: 'Support Staff',
  demo: true,
  courseIds: ['course-1'],
};

const activeJob: JobRecord = {
  id: 'job-va-specialist-01',
  publicationId: 'pub-va-01',
  version: 'starter-1.0',
  title: 'Virtual Assistant Specialist',
  organization: 'Savanna Digital Services',
  category: 'administrative',
  location: 'Addis Ababa',
  description:
    'Responsible for managing executive calendars, client correspondence in English and Amharic, digital document filing, and basic web research. Requires strong communication skills, attention to detail, and proficiency with remote productivity tools.',
  sourceUrl: 'https://digitalbridge.et/jobs/job-va-specialist-01',
  postedAt: new Date('2026-11-01T08:00:00.000Z'),
  expiresAt: new Date('2026-12-31T23:59:59.000Z'),
  withdrawn: false,
  status: 'active',
  isDemo: true,
  importedAt: new Date('2026-11-01T08:00:00.000Z'),
  provenance: {
    kind: 'demo',
    note: 'Synthetic demo job vacancy for testing',
  },
};

const expiredJob: JobRecord = {
  id: 'job-data-clerk-02',
  publicationId: 'pub-data-02',
  version: 'starter-1.0',
  title: 'Data Entry and Records Clerk',
  organization: 'Ethio Tech Solutions',
  category: 'administrative',
  location: 'Addis Ababa',
  description:
    'Accurately transcribe bilingual survey forms, verify database records, and compile weekly status summaries. Familiarity with spreadsheet applications and keyboard accessibility tools is an asset.',
  sourceUrl: 'https://digitalbridge.et/jobs/job-data-clerk-02',
  postedAt: new Date('2026-09-01T08:00:00.000Z'),
  expiresAt: new Date('2026-10-01T17:00:00.000Z'),
  withdrawn: false,
  status: 'expired',
  isDemo: true,
  importedAt: new Date('2026-09-01T08:00:00.000Z'),
  provenance: {
    kind: 'demo',
    note: 'Synthetic demo job vacancy representing expired role',
  },
};

function createMockRepository(jobs: JobRecord[]): JobRepository {
  return {
    // eslint-disable-next-line @typescript-eslint/require-await
    importJob: async () => {
      throw new Error('not implemented in test');
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    getJob: async (id: string) => jobs.find((j) => j.id === id) ?? null,
    // eslint-disable-next-line @typescript-eslint/require-await
    listJobs: async (filter = {}) => {
      let filtered = [...jobs];
      if (filter.status && filter.status !== 'all') {
        filtered = filtered.filter((j) => j.status === filter.status);
      }
      return filtered;
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    getPublicationEvent: async () => null,
  };
}

describe('JobAnswers Service (T3-019-B)', () => {
  const repo = createMockRepository([activeJob, expiredJob]);
  const jobAnswers = new JobAnswers(repo);
  const now = new Date('2026-11-15T09:00:00.000Z');

  describe('Routing Classification (Job vs. Course)', () => {
    it.each([
      'Are there any jobs available?',
      'What job openings are in Addis Ababa?',
      'Is Savanna Digital Services hiring?',
      'What are the requirements for Virtual Assistant Specialist?',
      'Where is the position located?',
      'How do I apply for the position?',
      'What is the salary for the VA job?',
      'Is the Data Entry Clerk job open?',
      'Can I apply for the data clerk position?',
    ])('classifies English job question correctly: "%s"', (q) => {
      expect(jobAnswers.isJobQuestion(q)).toBe(true);
    });

    it.each([
      'በአዲስ አበባ ውስጥ ክፍት የሥራ ቦታ አለ?',
      'የሥራ ዕድሎች ምንድን ናቸው?',
      'የዳታ ክለርክ ሥራ ክፍት ነው?',
      'የሥራ ቅጥር መረጃ አለ?',
      'ለሥራው ደመወዝ ስንት ነው?',
    ])('classifies Amharic job question correctly: "%s"', (q) => {
      expect(jobAnswers.isJobQuestion(q)).toBe(true);
    });

    it.each([
      'What is a virtual assistant?',
      'How does asynchronous communication work?',
      'What tools are covered in this course?',
      'Explain module 1',
      'What is photosynthesis?',
      'How do I submit my course assignment?',
    ])('distinguishes course questions (returns false): "%s"', (q) => {
      expect(jobAnswers.isJobQuestion(q)).toBe(false);
    });
  });

  describe('Active Job Answers with Grounded Citations', () => {
    it('answers general active job inquiry citing title, company, location, requirements, and link', async () => {
      const result = await jobAnswers.answer(
        learnerPrincipal,
        'What jobs are currently open in Addis Ababa?',
        now,
      );

      expect(result.kind).toBe('answered');
      expect(result.answerLang).toBe('en');
      expect(result.answerText).toContain('Virtual Assistant Specialist');
      expect(result.answerText).toContain('Savanna Digital Services');
      expect(result.answerText).toContain('Addis Ababa');
      expect(result.answerText).toContain('managing executive calendars');
      expect(result.answerText).toContain('https://digitalbridge.et/jobs/job-va-specialist-01');

      expect(result.citations).toHaveLength(1);
      const citation = result.citations[0];
      expect(citation?.sourceId).toBe('job-va-specialist-01');
      expect(citation?.sourceTitle).toBe('Savanna Digital Services — Virtual Assistant Specialist');
      expect(citation?.heading).toBe('Addis Ababa (Active)');
      expect(citation?.url).toBe('https://digitalbridge.et/jobs/job-va-specialist-01');
    });

    it('answers specific job requirements question citing the approved record', async () => {
      const result = await jobAnswers.answer(
        learnerPrincipal,
        'What are the requirements for the Virtual Assistant Specialist position?',
        now,
      );

      expect(result.kind).toBe('answered');
      expect(result.answerText).toContain('Requirements for Virtual Assistant Specialist');
      expect(result.answerText).toContain('managing executive calendars');
      expect(result.answerText).toContain('proficiency with remote productivity tools');
      expect(result.answerText).toContain('https://digitalbridge.et/jobs/job-va-specialist-01');
      expect(result.citations[0]?.sourceId).toBe('job-va-specialist-01');
    });

    it('answers location questions accurately citing the approved record', async () => {
      const result = await jobAnswers.answer(
        learnerPrincipal,
        'Where is the Virtual Assistant Specialist job located?',
        now,
      );

      expect(result.kind).toBe('answered');
      expect(result.answerText).toContain('is located in Addis Ababa');
      expect(result.citations[0]?.url).toBe('https://digitalbridge.et/jobs/job-va-specialist-01');
    });

    it('answers how to apply question with approved source link', async () => {
      const result = await jobAnswers.answer(
        learnerPrincipal,
        'How can I apply for the Virtual Assistant Specialist position?',
        now,
      );

      expect(result.kind).toBe('answered');
      expect(result.answerText).toContain('You can apply for the Virtual Assistant Specialist');
      expect(result.answerText).toContain('https://digitalbridge.et/jobs/job-va-specialist-01');
    });
  });

  describe('Expired Job Handling and Honest Limitation', () => {
    it('acknowledges expired job status explicitly when asked about a closed position', async () => {
      const result = await jobAnswers.answer(
        learnerPrincipal,
        'Is the Data Entry and Records Clerk job open?',
        now,
      );

      expect(result.kind).toBe('answered');
      expect(result.answerText).toContain(
        'expired on 2026-10-01 and is no longer open for applications',
      );
      expect(result.citations).toHaveLength(1);
      expect(result.citations[0]?.sourceId).toBe('job-data-clerk-02');
      expect(result.citations[0]?.heading).toBe('Addis Ababa (Expired)');
    });

    it('acknowledges expired status while citing historical requirements when asked', async () => {
      const result = await jobAnswers.answer(
        learnerPrincipal,
        'What were the requirements for the Data Entry and Records Clerk role?',
        now,
      );

      expect(result.kind).toBe('answered');
      expect(result.answerText).toContain(
        'expired on 2026-10-01 and is no longer open for applications',
      );
      expect(result.answerText).toContain('transcribe bilingual survey forms');
      expect(result.citations[0]?.sourceId).toBe('job-data-clerk-02');
    });
  });

  describe('Missing Facts and Unknown Jobs', () => {
    it('explicitly acknowledges missing salary details rather than hallucinating', async () => {
      const result = await jobAnswers.answer(
        learnerPrincipal,
        'What is the salary for the Virtual Assistant Specialist position?',
        now,
      );

      expect(result.kind).toBe('insufficient_evidence');
      expect(result.answerText).toContain('does not specify salary information');
      expect(result.answerText).toContain('https://digitalbridge.et/jobs/job-va-specialist-01');
      expect(result.citations[0]?.sourceId).toBe('job-va-specialist-01');
    });

    it('returns honest limitation without web search or citations for unapproved/unknown positions', async () => {
      const result = await jobAnswers.answer(
        learnerPrincipal,
        'Is Google hiring a Software Engineer in Addis Ababa?',
        now,
      );

      expect(result.kind).toBe('insufficient_evidence');
      expect(result.answerText).toBe(
        'I do not have an approved job record for that position or organization. External web search is not used.',
      );
      expect(result.citations).toEqual([]);
    });
  });

  describe('Permission & Safe Output', () => {
    it('denies access to non-learner principals', async () => {
      const result = await jobAnswers.answer(supportPrincipal, 'What jobs are open?', now);

      expect(result.kind).toBe('insufficient_evidence');
      expect(result.answerText).toContain('restricted to authenticated learners');
      expect(result.citations).toEqual([]);
    });
  });

  describe('Amharic Grounded Answers', () => {
    it('answers active job questions in Amharic with citations and links', async () => {
      const result = await jobAnswers.answer(learnerPrincipal, 'በአዲስ አበባ ክፍት የሥራ ቦታ አለ?', now);

      expect(result.kind).toBe('answered');
      expect(result.answerLang).toBe('am');
      expect(result.answerText).toContain('Savanna Digital Services');
      expect(result.answerText).toContain('Virtual Assistant Specialist');
      expect(result.answerText).toContain('https://digitalbridge.et/jobs/job-va-specialist-01');
      expect(result.citations[0]?.sourceId).toBe('job-va-specialist-01');
    });

    it('acknowledges expired job status in Amharic', async () => {
      const result = await jobAnswers.answer(learnerPrincipal, 'የዳታ ክለርክ ሥራ ክፍት ነው?', now);

      expect(result.kind).toBe('answered');
      expect(result.answerLang).toBe('am');
      expect(result.answerText).toContain('ጊዜው ያለፈበት');
      expect(result.answerText).toContain('ክፍት አይደለም');
      expect(result.citations[0]?.sourceId).toBe('job-data-clerk-02');
    });

    it('acknowledges unknown jobs in Amharic without external search', async () => {
      const result = await jobAnswers.answer(
        learnerPrincipal,
        'በአዲስ አበባ ውስጥ የኮምፒውተር ኢንጂነር ሥራ አለ?',
        now,
      );

      expect(result.kind).toBe('insufficient_evidence');
      expect(result.answerLang).toBe('am');
      expect(result.answerText).toContain('የተረጋገጠ የሥራ መረጃ አልተገኘም');
      expect(result.answerText).toContain('የበይነመረብ ፍለጋ አልተካተተም');
      expect(result.citations).toEqual([]);
    });
  });
});
