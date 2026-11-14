// Deterministic, explicitly labelled demo replies for building and testing the
// interface before the real tutor exists. Nothing here is a tutor answer.
import type { AskResult, ConversationClient } from './conversation.ts';

export const FIXTURE_SCENARIOS = {
  english: 'English reply',
  amharic: 'Amharic reply',
  mixed: 'Mixed-direction reply (Arabic first)',
  markup: 'Reply containing HTML markup',
  slow: 'Slow reply (3 seconds)',
  denied: 'Session expired',
  failed: 'Network failure',
} as const;

export type FixtureScenario = keyof typeof FIXTURE_SCENARIOS;

export function isFixtureScenario(value: string): value is FixtureScenario {
  return Object.hasOwn(FIXTURE_SCENARIOS, value);
}

const SLOW_REPLY_MS = 3000;

// Known date fixture for T3-006-D: 1 Meskerem 2019 / 11 September 2026, 15:00
// Addis Ababa time. Keeping it fixed makes the browser and unit checks deterministic.
export const FIXTURE_REPLY_CREATED_AT = '2026-09-11T12:00:00.000Z';

// Amharic wording needs competent-speaker review with the translations (T3-006-C).
const REPLY_TEXT: Record<'english' | 'amharic' | 'mixed' | 'markup', [text: string, lang: string]> =
  {
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
      const [text, lang] = REPLY_TEXT[scenario === 'slow' ? 'english' : scenario];
      return {
        kind: 'answer',
        reply: {
          id: `fixture-${nextReplyId++}`,
          text,
          lang,
          createdAt: FIXTURE_REPLY_CREATED_AT,
        },
      };
    },
  };
}
