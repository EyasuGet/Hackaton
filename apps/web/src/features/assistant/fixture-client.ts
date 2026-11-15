// Deterministic, explicitly labelled demo replies for building and testing the
// interface before the real tutor exists. Includes cited FAQ scenarios (T3-007-A).
import type { MessageKey } from '../../shared/i18n/i18n.tsx';
import type { AskOptions, AskResult, Citation, ConversationClient } from './conversation.ts';

/** Each scenario and the dictionary key of its label in the demo selector. */
export const FIXTURE_SCENARIOS = {
  faqCited: 'demo.scenario.faqCited',
  faqLimitation: 'demo.scenario.faqLimitation',
  simpleLanguageCited: 'demo.scenario.simpleLanguageCited',
  simpleLanguageLimitation: 'demo.scenario.simpleLanguageLimitation',
  english: 'demo.scenario.english',
  amharic: 'demo.scenario.amharic',
  mixed: 'demo.scenario.mixed',
  markup: 'demo.scenario.markup',
  slow: 'demo.scenario.slow',
  denied: 'demo.scenario.denied',
  failed: 'demo.scenario.failed',
  jobActive: 'demo.scenario.jobActive',
  jobExpired: 'demo.scenario.jobExpired',
  jobUnknown: 'demo.scenario.jobUnknown',
  researchSuccess: 'demo.scenario.researchSuccess',
  researchLimitation: 'demo.scenario.researchLimitation',
} as const satisfies Record<string, MessageKey>;

export type FixtureScenario = keyof typeof FIXTURE_SCENARIOS;

export function isFixtureScenario(value: string): value is FixtureScenario {
  return Object.hasOwn(FIXTURE_SCENARIOS, value);
}

const SLOW_REPLY_MS = 3000;

// Known date fixture for T3-006-D: 1 Meskerem 2019 / 11 September 2026, 15:00
// Addis Ababa time. Keeping it fixed makes the browser and unit checks deterministic.
export const FIXTURE_REPLY_CREATED_AT = '2026-09-11T12:00:00.000Z';

const SAVANNA_CITATION: Citation = {
  sourceId: 'savanna-va1-future-of-va-industry',
  sectionId: 'introduction',
  sourceTitle: 'The Future of the VA Industry',
  heading: 'Introduction',
};

const VA_JOB_CITATION: Citation = {
  sourceId: 'job-va-specialist-01',
  sectionId: 'requirements',
  sourceTitle: 'Savanna Digital Services — Virtual Assistant Specialist',
  heading: 'Addis Ababa (Active)',
  url: 'https://digitalbridge.et/jobs/job-va-specialist-01',
};

const DATA_CLERK_CITATION: Citation = {
  sourceId: 'job-data-clerk-02',
  sectionId: 'status',
  sourceTitle: 'Ethio Tech Solutions — Data Entry and Records Clerk',
  heading: 'Addis Ababa (Expired)',
  url: 'https://digitalbridge.et/jobs/job-data-clerk-02',
};

const RESEARCH_CITATION: Citation = {
  sourceId: 'web-market-01',
  sectionId: 'salary',
  sourceTitle: 'Addis Ababa Remote Work Trends 2026',
  heading: 'Virtual Assistant Compensation and Opportunities',
  url: 'https://digitalbridge.et/research/va-2026',
};

// Amharic wording needs competent-speaker review with the translations (T3-006-C).
const REPLY_TEXT: Record<
  | 'faqCited'
  | 'faqLimitation'
  | 'simpleLanguageCited'
  | 'simpleLanguageLimitation'
  | 'english'
  | 'amharic'
  | 'mixed'
  | 'markup'
  | 'jobActive'
  | 'jobExpired'
  | 'jobUnknown'
  | 'researchSuccess'
  | 'researchLimitation',
  [
    text: string,
    lang: string,
    citations?: readonly Citation[],
    provider?: 'online' | 'faq' | 'job' | 'external_web_research',
  ]
> = {
  faqCited: [
    'Virtual Assistant can mean AI software assistants such as chatbots or human remote professionals providing business support online.',
    'en',
    [SAVANNA_CITATION],
    'faq',
  ],
  faqLimitation: [
    'I do not have an approved course answer for that question in the materials.',
    'en',
    [],
    'faq',
  ],
  simpleLanguageCited: [
    'A virtual assistant helps people with online tasks. They can be software like a chatbot or a person working from home.',
    'en',
    [SAVANNA_CITATION],
    'online',
  ],
  simpleLanguageLimitation: [
    'I do not have an approved answer for that question in the course lessons.',
    'en',
    [],
    'online',
  ],
  english: ['This is a demo reply from a test fixture, not a tutor answer.', 'en'],
  amharic: ['ይህ የሙከራ መልስ ነው። እውነተኛ የትምህርት መልስ አይደለም።', 'am'],
  // Starts right-to-left so dir="auto" must resolve to RTL; English and Amharic are embedded.
  mixed: ['«مرحبا بكم» تعني “welcome” بالإنجليزية፤ و«እንኳን ደህና መጡ» بالأمهرية.', 'ar'],
  markup: [
    'Demo text with markup that must stay inert: <img src="x" onerror="alert(1)"> <script>alert(2)</script>',
    'en',
  ],
  jobActive: [
    'Savanna Digital Services has an active opening for a Virtual Assistant Specialist in Addis Ababa. Requirements: managing executive calendars, client correspondence in English and Amharic, digital document filing, and basic web research, proficiency with remote productivity tools. Approved link: https://digitalbridge.et/jobs/job-va-specialist-01',
    'en',
    [VA_JOB_CITATION],
    'job',
  ],
  jobExpired: [
    'The Data Entry and Records Clerk position at Ethio Tech Solutions (Addis Ababa) expired on 2026-10-01 and is no longer open for applications.',
    'en',
    [DATA_CLERK_CITATION],
    'job',
  ],
  jobUnknown: [
    'I do not have an approved job record for that position or organization. External web search is not used.',
    'en',
    [],
    'job',
  ],
  researchSuccess: [
    'Market research shows active demand for Virtual Assistants in Addis Ababa with competitive entry-level salaries and remote flexibility.',
    'en',
    [RESEARCH_CITATION],
    'external_web_research',
  ],
  researchLimitation: [
    'No verified external career research could be located for that specific query.',
    'en',
    [],
    'external_web_research',
  ],
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A counter, not crypto.randomUUID(): the demo must also work over plain HTTP on a
// local network (for example a phone running TalkBack), where randomUUID is unavailable.
let nextReplyId = 1;

export function createFixtureClient(scenario: FixtureScenario): ConversationClient {
  return {
    async ask(_question: string, options?: AskOptions): Promise<AskResult> {
      if (scenario === 'slow') await wait(SLOW_REPLY_MS);
      if (scenario === 'denied' || scenario === 'failed') return { kind: scenario };
      const [text, lang, citations, provider] =
        REPLY_TEXT[scenario === 'slow' ? 'english' : scenario];
      const isSimple =
        scenario === 'simpleLanguageCited' ||
        scenario === 'simpleLanguageLimitation' ||
        options?.simpleLanguage === true;
      return {
        kind: 'answer',
        reply: {
          id: `fixture-${nextReplyId++}`,
          text,
          lang,
          createdAt: FIXTURE_REPLY_CREATED_AT,
          ...(citations && citations.length > 0 ? { citations } : {}),
          ...(provider ? { provider } : {}),
          ...(isSimple ? { simpleLanguage: true } : {}),
        },
      };
    },
  };
}
