// Deterministic, explicitly labelled demo replies for building and testing the
// interface before the real tutor exists. Includes cited FAQ scenarios (T3-007-A).
import type { MessageKey } from '../../shared/i18n/i18n.tsx';
import type { AskResult, Citation, ConversationClient } from './conversation.ts';

/** Each scenario and the dictionary key of its label in the demo selector. */
export const FIXTURE_SCENARIOS = {
  faqCited: 'demo.scenario.faqCited',
  faqLimitation: 'demo.scenario.faqLimitation',
  english: 'demo.scenario.english',
  amharic: 'demo.scenario.amharic',
  mixed: 'demo.scenario.mixed',
  markup: 'demo.scenario.markup',
  slow: 'demo.scenario.slow',
  denied: 'demo.scenario.denied',
  failed: 'demo.scenario.failed',
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

// Amharic wording needs competent-speaker review with the translations (T3-006-C).
const REPLY_TEXT: Record<
  'faqCited' | 'faqLimitation' | 'english' | 'amharic' | 'mixed' | 'markup',
  [text: string, lang: string, citations?: readonly Citation[]]
> = {
  faqCited: [
    'Virtual Assistant can mean AI software assistants such as chatbots or human remote professionals providing business support online.',
    'en',
    [SAVANNA_CITATION],
  ],
  faqLimitation: [
    'I do not have an approved course answer for that question in the materials.',
    'en',
    [],
  ],
  english: ['This is a demo reply from a test fixture, not a tutor answer.', 'en'],
  amharic: ['ይህ የሙከራ መልስ ነው። እውነተኛ የትምህርት መልስ አይደለም።', 'am'],
  // Starts right-to-left so dir="auto" must resolve to RTL; English and Amharic are embedded.
  mixed: ['«مرحبا بكم» تعني “welcome” بالإنجليزية، و«እንኳን ደህና መጡ» بالأمهرية.', 'ar'],
  markup: [
    'Demo text with markup that must stay inert: <img src="x" onerror="alert(1)"> <script>alert(2)</script>',
    'en',
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
    async ask(): Promise<AskResult> {
      if (scenario === 'slow') await wait(SLOW_REPLY_MS);
      if (scenario === 'denied' || scenario === 'failed') return { kind: scenario };
      const [text, lang, citations] = REPLY_TEXT[scenario === 'slow' ? 'english' : scenario];
      return {
        kind: 'answer',
        reply: {
          id: `fixture-${nextReplyId++}`,
          text,
          lang,
          createdAt: FIXTURE_REPLY_CREATED_AT,
          ...(citations && citations.length > 0 ? { citations } : {}),
        },
      };
    },
  };
}
