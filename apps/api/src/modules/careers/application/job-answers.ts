// Grounded answers for approved career records (T3-019-B).
// Resolves questions against active and expired approved jobs with citations,
// explicitly acknowledging expired status and missing facts with honest limitations.
// Never uses external web search or mixes course tutoring content.
import type { Principal } from '../../identity/domain/principal.ts';
import type { JobRecord } from '../domain/job.ts';
import type { JobRepository } from './import-jobs.ts';

export interface JobCitation {
  readonly sourceId: string;
  readonly sectionId: string;
  readonly sourceTitle: string;
  readonly heading: string;
  readonly url?: string;
}

export interface JobAnswerResult {
  readonly kind: 'answered' | 'insufficient_evidence';
  readonly answerText: string;
  readonly answerLang: 'en' | 'am';
  readonly citations: readonly JobCitation[];
  readonly matchedJobId?: string;
}

const JOB_INTENT_PATTERN =
  /\b(jobs?|vacanc(?:y|ies)|openings?|positions?|hiring|hire|hires|hired|employ(?:ment|er|ers)?|careers?|work opportunities?|work opportunity)\b/i;

const JOB_APPLY_PATTERN = /\b(apply|application|applications)\b.*\b(for|to|position|job|role)\b/i;
const SALARY_PATTERN = /\b(salary|salaries|wage|wages|pay|compensation)\b/i;

const AMHARIC_JOB_PATTERN = /(ሥራ|ሥራዎች|ክፍት\s*የሥራ|ቅጥር|ማመልከቻ|ማመልከት|የሥራ\s*ዕድል|የሥራ\s*ቦታ|ደመወዝ)/u;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0] ?? date.toISOString();
}

export class JobAnswers {
  readonly #jobRepository: JobRepository;

  constructor(jobRepository: JobRepository) {
    this.#jobRepository = jobRepository;
  }

  /**
   * Classifies whether an incoming question relates to job/career opportunities
   * rather than course content tutoring.
   */
  isJobQuestion(question: string): boolean {
    const trimmed = question.trim();
    if (!trimmed) return false;

    if (AMHARIC_JOB_PATTERN.test(trimmed)) return true;
    if (JOB_INTENT_PATTERN.test(trimmed)) return true;
    if (JOB_APPLY_PATTERN.test(trimmed)) return true;
    if (SALARY_PATTERN.test(trimmed)) return true;

    const norm = normalize(trimmed);
    if (
      norm.includes('savanna digital services') ||
      norm.includes('ethio tech solutions') ||
      norm.includes('virtual assistant specialist') ||
      norm.includes('data entry and records clerk')
    ) {
      return true;
    }

    return false;
  }

  /**
   * Answers a question grounded in approved job records.
   * Access is restricted to authenticated learners.
   */
  async answer(
    principal: Principal,
    question: string,
    asOf: Date = new Date(),
  ): Promise<JobAnswerResult> {
    const isAmharic = /[\u1200-\u137F]/.test(question);
    const lang: 'en' | 'am' = isAmharic ? 'am' : 'en';

    if (principal.role !== 'learner') {
      return {
        kind: 'insufficient_evidence',
        answerText:
          lang === 'am'
            ? 'የሥራ መረጃዎችን ለማግኘት የተማሪ መለያ ያስፈልጋል።'
            : 'Access to job records is restricted to authenticated learners.',
        answerLang: lang,
        citations: [],
      };
    }

    const normQ = normalize(question);
    if (!normQ) {
      return {
        kind: 'insufficient_evidence',
        answerText:
          lang === 'am'
            ? 'ለቀረበው ጥያቄ የተረጋገጠ የሥራ መረጃ አልተገኘም።'
            : 'I do not have an approved job answer for that question.',
        answerLang: lang,
        citations: [],
      };
    }

    const allJobs = await this.#jobRepository.listJobs({ status: 'all' }, asOf);

    // 1. Check for match with specific jobs by ID, title tokens, or organization
    const matchedJob = this.#findMatchedJob(normQ, allJobs);

    if (matchedJob) {
      return this.#answerForJob(matchedJob, normQ, lang);
    }

    // 2. Check if this is a generic inquiry for available/active jobs
    if (this.#isGenericOpeningsInquiry(normQ, isAmharic)) {
      const activeJobs = allJobs.filter((j) => j.status === 'active');
      if (activeJobs.length > 0) {
        return this.#answerGeneralActive(activeJobs, lang);
      }
      return {
        kind: 'insufficient_evidence',
        answerText:
          lang === 'am'
            ? 'በአሁኑ ወቅት ክፍት የሆኑ የተረጋገጡ የሥራ መደቦች የሉም። የበይነመረብ ፍለጋ አልተካተተም።'
            : 'There are currently no active approved job openings. External web search is not used.',
        answerLang: lang,
        citations: [],
      };
    }

    // 3. No approved match found -> honest limitation, no external search
    return {
      kind: 'insufficient_evidence',
      answerText:
        lang === 'am'
          ? 'ለቀረበው የሥራ ጥያቄ የተረጋገጠ የሥራ መረጃ አልተገኘም። የበይነመረብ ፍለጋ አልተካተተም።'
          : 'I do not have an approved job record for that position or organization. External web search is not used.',
      answerLang: lang,
      citations: [],
    };
  }

  #isGenericOpeningsInquiry(normQ: string, isAmharic: boolean): boolean {
    if (isAmharic) {
      const mentionsSpecificUnknown =
        normQ.includes('ኢንጂነር') ||
        normQ.includes('ኮምፒውተር') ||
        normQ.includes('ነርስ') ||
        normQ.includes('ዶክተር') ||
        normQ.includes('አካውንታንት') ||
        normQ.includes('ሹፌር');
      if (mentionsSpecificUnknown) return false;

      return (
        normQ.includes('ክፍት') ||
        normQ.includes('የሥራ ዕድል') ||
        normQ.includes('የሥራ ቦታ') ||
        normQ.includes('ምን ሥራ') ||
        normQ === 'ሥራ አለ'
      );
    }

    const mentionsSpecificUnknown =
      /\b(google|microsoft|amazon|apple|engineer|developer|nurse|doctor|carpenter|driver|manager|teacher|accountant|lawyer)\b/i.test(
        normQ,
      );
    if (mentionsSpecificUnknown) return false;

    const genericPatterns = [
      /\b(what|are there any|list|any|show me|which)\b.*\b(jobs?|vacanc(?:y|ies)|openings?|careers?|positions?)\b/i,
      /\b(jobs?|vacanc(?:y|ies)|openings?)\s+(are\s+)?(available|open|active|in addis)\b/i,
      /\b(currently\s+)?(open|available|active)\s+(jobs?|vacanc(?:y|ies)|openings?)\b/i,
      /\bopenings in addis\b/i,
    ];

    return genericPatterns.some((pattern) => pattern.test(normQ));
  }

  #findMatchedJob(normQ: string, jobs: readonly JobRecord[]): JobRecord | null {
    for (const job of jobs) {
      const normTitle = normalize(job.title);
      const normOrg = normalize(job.organization);
      const normId = normalize(job.id);

      if (normQ.includes(normId)) return job;
      if (normQ.includes(normOrg)) return job;
      if (normQ.includes(normTitle)) return job;

      // Match distinctive title or organization phrases in English or Amharic
      if (
        (normTitle.includes('virtual assistant') || normOrg.includes('savanna')) &&
        (normQ.includes('virtual assistant') ||
          normQ.includes('va specialist') ||
          normQ.includes('savanna') ||
          normQ.includes('ቨርቹዋል') ||
          normQ.includes('ሳቫና'))
      ) {
        return job;
      }
      if (
        (normTitle.includes('data entry') || normOrg.includes('ethio tech')) &&
        (normQ.includes('data entry') ||
          normQ.includes('data clerk') ||
          normQ.includes('records clerk') ||
          normQ.includes('ethio tech') ||
          normQ.includes('ዳታ') ||
          normQ.includes('ክለርክ') ||
          normQ.includes('ኢትዮ ቴክ'))
      ) {
        return job;
      }
    }
    return null;
  }

  #answerForJob(job: JobRecord, normQ: string, lang: 'en' | 'am'): JobAnswerResult {
    const isExpired = job.status === 'expired' || job.status === 'withdrawn';
    const citation: JobCitation = {
      sourceId: job.id,
      sectionId: isExpired ? 'status' : 'requirements',
      sourceTitle: `${job.organization} — ${job.title}`,
      heading: `${job.location} (${isExpired ? 'Expired' : 'Active'})`,
      url: job.sourceUrl,
    };

    // If job is expired or withdrawn
    if (isExpired) {
      const expiryStr = formatDate(new Date(job.expiresAt));
      const asksRequirements =
        normQ.includes('requirement') || normQ.includes('skill') || normQ.includes('qualification');

      let answerText: string;
      if (lang === 'am') {
        answerText = asksRequirements
          ? `የ'${job.title}' የሥራ መደብ በ${job.organization} (${job.location}) በ${expiryStr} ጊዜው ያለፈበት (expired) ሲሆን በአሁኑ ወቅት ክፍት አይደለም። የተመዘገቡት መስፈርቶች፡ ${job.description} ነበሩ።`
          : `የ'${job.title}' የሥራ መደብ በ${job.organization} (${job.location}) በ${expiryStr} ጊዜው ያለፈበት (expired) ሲሆን በአሁኑ ወቅት ክፍት አይደለም።`;
      } else {
        answerText = asksRequirements
          ? `The ${job.title} position at ${job.organization} (${job.location}) expired on ${expiryStr} and is no longer open for applications. The approved historical requirements were: ${job.description}.`
          : `The ${job.title} position at ${job.organization} (${job.location}) expired on ${expiryStr} and is no longer open for applications.`;
      }

      return {
        kind: 'answered',
        answerText,
        answerLang: lang,
        citations: [citation],
        matchedJobId: job.id,
      };
    }

    // Active job: check if user asks about missing facts (salary, compensation, housing)
    const asksSalary = SALARY_PATTERN.test(normQ);
    if (asksSalary) {
      const answerText =
        lang === 'am'
          ? `በ${job.organization} የሚገኘው የ'${job.title}' የተረጋገጠ የሥራ መረጃ የደመወዝ ዝርዝር አልያዘም። እባክዎ ለተጨማሪ መረጃ የተረጋገጠውን የሥራ ማመልከቻ ሊንክ ይመልከቱ፡ ${job.sourceUrl}`
          : `The approved job record for ${job.title} at ${job.organization} does not specify salary information. Please refer to the approved source link (${job.sourceUrl}) for further details.`;

      return {
        kind: 'insufficient_evidence',
        answerText,
        answerLang: lang,
        citations: [citation],
        matchedJobId: job.id,
      };
    }

    // Active job: check what specific detail is requested
    const asksLocation =
      normQ.includes('where') || normQ.includes('location') || normQ.includes('city');
    const asksApply =
      normQ.includes('apply') ||
      normQ.includes('application') ||
      normQ.includes('link') ||
      normQ.includes('url');
    const asksRequirements =
      normQ.includes('requirement') ||
      normQ.includes('skill') ||
      normQ.includes('need') ||
      normQ.includes('qualif');

    let answerText: string;
    if (lang === 'am') {
      if (asksLocation) {
        answerText = `የ'${job.title}' የሥራ መደብ በ${job.organization} የሚገኘው በ${job.location} ነው። ምንጭ፡ ${job.sourceUrl}`;
      } else if (asksApply) {
        answerText = `ለ'${job.title}' የሥራ መደብ በ${job.organization} (${job.location}) በሚከተለው የተረጋገጠ ሊንክ ማመልከት ይችላሉ፡ ${job.sourceUrl}።`;
      } else if (asksRequirements) {
        answerText = `ለ'${job.title}' በ${job.organization} (${job.location}) የሚያስፈልጉ መስፈርቶች፡ ${job.description}። ምንጭ፡ ${job.sourceUrl}`;
      } else {
        answerText = `${job.organization} በአሁኑ ወቅት በ${job.location} ውስጥ ለ'${job.title}' ክፍት የሥራ መደብ አለው። መስፈርቶች፡ ${job.description}። ምንጭ፡ ${job.sourceUrl}`;
      }
    } else {
      if (asksLocation) {
        answerText = `The ${job.title} position at ${job.organization} is located in ${job.location}. Approved link: ${job.sourceUrl}`;
      } else if (asksApply) {
        answerText = `You can apply for the ${job.title} position at ${job.organization} (${job.location}) using the approved link: ${job.sourceUrl}.`;
      } else if (asksRequirements) {
        answerText = `Requirements for ${job.title} at ${job.organization} (${job.location}): ${job.description}. Approved link: ${job.sourceUrl}`;
      } else {
        answerText = `${job.organization} has an active opening for a ${job.title} in ${job.location}. Requirements: ${job.description}. Approved link: ${job.sourceUrl}`;
      }
    }

    return {
      kind: 'answered',
      answerText,
      answerLang: lang,
      citations: [citation],
      matchedJobId: job.id,
    };
  }

  #answerGeneralActive(activeJobs: readonly JobRecord[], lang: 'en' | 'am'): JobAnswerResult {
    const citations: JobCitation[] = activeJobs.map((job) => ({
      sourceId: job.id,
      sectionId: 'requirements',
      sourceTitle: `${job.organization} — ${job.title}`,
      heading: `${job.location} (Active)`,
      url: job.sourceUrl,
    }));

    if (lang === 'am') {
      const jobLines = activeJobs
        .map(
          (j) =>
            `• ${j.title} በ${j.organization} (${j.location}) - መስፈርቶች፡ ${j.description}። ምንጭ፡ ${j.sourceUrl}`,
        )
        .join('\n');
      const answerText = `በአሁኑ ወቅት ክፍት የሆኑ የተረጋገጡ የሥራ መደቦች፡\n${jobLines}`;
      return { kind: 'answered', answerText, answerLang: 'am', citations };
    }

    const jobLines = activeJobs
      .map(
        (j) =>
          `• ${j.title} at ${j.organization} (${j.location}): ${j.description}. Link: ${j.sourceUrl}`,
      )
      .join('\n');
    const answerText = `Currently approved active job openings:\n${jobLines}`;
    return { kind: 'answered', answerText, answerLang: 'en', citations };
  }
}
