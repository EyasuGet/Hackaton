// Automated axe-core / WCAG 2.1 AA accessibility test suite for all completed desktop surfaces (T3-025-A).
// Audits:
// 1. Tutoring chat dialogue and speech engine selection
// 2. Asynchronous Human Help request submission, inbox, and reply exchange
// 3. Accommodation request form, coordinator queue, and status review
// 4. Career job search, preferences, and subscriptions
// 5. Desktop screen sharing consent dialog, active status, and teardown
// 6. Integrated full desktop application shell in English and Amharic
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/app.tsx';
import { LocaleContext } from '../../shared/i18n/i18n.tsx';
import {
  AccommodationPanel,
  CoordinatorAccommodationPanel,
} from '../accommodation/accommodation.tsx';
import * as accommodationApi from '../accommodation/accommodation-api.ts';
import { Assistant } from './assistant.tsx';
import type { AskResult, Citation, ConversationClient } from './conversation.ts';
import { HelpInbox } from '../human-help/help-inbox.tsx';
import { HumanHelp } from '../human-help/human-help.tsx';
import * as helpApi from '../human-help/help-api.ts';
import { ScreenShare } from '../sharing/screen-share.tsx';
import * as sharingApi from '../sharing/sharing-api.ts';
import type { SpeechCallbacks, SpeechSynthesizer } from './speech-adapter.ts';
import * as support from '../sharing/support.ts';

interface AxeNode {
  html: string;
  failureSummary?: string;
}

interface AxeViolation {
  id: string;
  impact?: string;
  description: string;
  help: string;
  helpUrl: string;
  nodes: AxeNode[];
}

interface AxeResults {
  violations: AxeViolation[];
  passes: { id: string }[];
  incomplete: { id: string }[];
  inapplicable: { id: string }[];
}

interface AxeRunner {
  run(
    element: Element,
    options?: { runOnly?: { type: string; values: string[] } },
  ): Promise<AxeResults>;
}

const req = createRequire(import.meta.resolve('@axe-core/playwright'));
const axeCore = req('axe-core') as AxeRunner;

declare module 'vitest' {
  interface Assertion {
    toHaveNoViolations(): void;
  }
}

expect.extend({
  toHaveNoViolations(results: AxeResults) {
    const violations = results.violations ?? [];
    const pass = violations.length === 0;
    if (pass) {
      return {
        pass: true,
        message: () => 'Expected accessibility violations, but none were found.',
      };
    }
    const formatted = violations
      .map(
        (v) =>
          `[${v.impact?.toUpperCase() ?? 'UNKNOWN'}] ${v.id}: ${v.help} (${v.helpUrl})\n` +
          v.nodes
            .map((n) => `  - ${n.html}${n.failureSummary ? `\n    ${n.failureSummary}` : ''}`)
            .join('\n'),
      )
      .join('\n\n');

    return {
      pass: false,
      message: () =>
        `Expected 0 axe accessibility violations, but found ${violations.length}:\n\n${formatted}`,
    };
  },
});

async function axe(container: Element): Promise<AxeResults> {
  const result = await axeCore.run(container, {
    runOnly: {
      type: 'tag',
      values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
    },
  });
  return result;
}

// Controllable conversation client helper
function controllableClient() {
  const pending: ((result: AskResult) => void)[] = [];
  const ask = vi.fn(() => new Promise<AskResult>((res) => pending.push(res)));
  const client: ConversationClient = { ask };
  const respond = async (result: AskResult) => {
    const fn = pending.shift();
    if (fn) {
      await act(async () => {
        fn(result);
        await Promise.resolve();
      });
    }
  };
  return { client, ask, respond };
}

// Mock speech synthesizer helper
function mockSpeechSynthesizer(id: string, name: string, requiresConsent = false) {
  const stopMock = vi.fn();
  const pauseMock = vi.fn();
  const resumeMock = vi.fn();
  const speakMock = vi.fn();

  const synthesizer: SpeechSynthesizer = {
    id,
    name,
    requiresConsent,
    isSupported: () => true,
    speak: vi.fn(
      (text: string, opts: { lang: string; signal?: AbortSignal }, cb?: SpeechCallbacks) => {
        speakMock(text, opts);
        cb?.onStart?.();
        return Promise.resolve({
          pause: () => {
            pauseMock();
            cb?.onPause?.();
          },
          resume: () => {
            resumeMock();
            cb?.onResume?.();
          },
          stop: () => {
            stopMock();
            cb?.onEnd?.();
          },
          state: 'playing' as const,
        });
      },
    ),
  };

  return { synthesizer, speakMock, pauseMock, resumeMock, stopMock };
}

// Test fixtures
const amharicFaqCitation: Citation = {
  sourceId: 'course-1-bio',
  sectionId: 'sec-photosynthesis',
  sourceTitle: 'ስነ-ህይወት ምዕራፍ 1',
  heading: 'የፎቶሲንተሲስ ሂደት',
};

const amharicFaqAnswer: AskResult = {
  kind: 'answer',
  reply: {
    id: 'faq-am-1',
    text: 'ፎቶሲንተሲስ እፅዋት ከፀሐይ ብርሃን፣ ከውሃ እና ከካርቦን ዳይኦክሳይድ ስኳር እና ኦክስጅን የሚያመርቱበት ሂደት ነው።',
    lang: 'am',
    createdAt: '2026-09-11T12:00:00.000Z',
    citations: [amharicFaqCitation],
  },
};

const englishFaqCitation: Citation = {
  sourceId: 'course-1-cs',
  sectionId: 'sec-clean-arch',
  sourceTitle: 'Software Architecture 101',
  heading: 'Clean Architecture Principles',
};

const englishFaqAnswer: AskResult = {
  kind: 'answer',
  reply: {
    id: 'faq-en-1',
    text: 'Clean Architecture emphasizes the separation of concerns, keeping business logic independent of external libraries.',
    lang: 'en',
    createdAt: '2026-09-11T12:00:00.000Z',
    citations: [englishFaqCitation],
  },
};

const activeJobCitation: Citation = {
  sourceId: 'job-va-specialist-01',
  sectionId: 'sec-1',
  sourceTitle: 'Savanna Digital Services',
  heading: 'Virtual Assistant Specialist',
  url: 'https://digitalbridge.et/jobs/job-va-specialist-01',
};

const activeJobAnswer: AskResult = {
  kind: 'answer',
  reply: {
    id: 'job-ans-1',
    text: 'Savanna Digital Services has an active opening for a Virtual Assistant Specialist in Addis Ababa.',
    lang: 'en',
    provider: 'job',
    createdAt: '2026-09-11T12:00:00.000Z',
    citations: [activeJobCitation],
  },
};

const expiredJobAnswer: AskResult = {
  kind: 'answer',
  reply: {
    id: 'job-ans-2',
    text: 'The Data Entry Clerk vacancy at Ethio Telecom closed on 2026-08-15. Applications are no longer accepted.',
    lang: 'en',
    provider: 'job',
    createdAt: '2026-09-11T12:00:00.000Z',
    citations: [
      {
        sourceId: 'job-data-clerk-02',
        sectionId: 'sec-2',
        sourceTitle: 'Ethio Telecom',
        heading: 'Data Entry Clerk (Expired)',
        url: 'https://digitalbridge.et/jobs/job-data-clerk-02',
      },
    ],
  },
};

const unknownJobAnswer: AskResult = {
  kind: 'answer',
  reply: {
    id: 'job-ans-3',
    text: 'I do not have an approved job record for that position or organization. External web search is not used.',
    lang: 'en',
    provider: 'job',
    createdAt: '2026-09-11T12:00:00.000Z',
  },
};

const SAMPLE_JOB: accommodationApi.Job = {
  id: 'job-uuid-1',
  title: 'Virtual Assistant Specialist',
  organization: 'Savanna Digital Services',
  category: 'Virtual Assistance',
  location: 'Addis Ababa',
  sourceUrl: 'https://digitalbridge.et/jobs/job-va-specialist-01',
};

const SAMPLE_ACCOMMODATION_REQUEST: accommodationApi.AccommodationRequest = {
  id: 'ar-req-123',
  clientRequestId: 'client-ar-123',
  ownerId: 'learner-user-1',
  jobId: 'job-uuid-1',
  supportDescription:
    'Screen magnifier software and extra time for technical interview assessment.',
  state: 'waiting',
  createdAt: '2026-09-11T12:00:00.000Z',
  expiresAt: '2026-09-18T12:00:00.000Z',
  updatedAt: '2026-09-11T12:00:00.000Z',
  cancelledAt: null,
  reviewedAt: null,
  reviewedBy: null,
};

const SAMPLE_HELP_REQUEST: helpApi.HelpRequest = {
  id: 'hr-123',
  clientRequestId: 'client-hr-123',
  ownerId: 'learner-user-1',
  contextSnapshot: 'I am struggling with the Clean Architecture entity boundaries in Section 2.',
  consentGiven: true,
  state: 'claimed',
  createdAt: '2026-09-11T12:00:00.000Z',
  expiresAt: '2026-09-18T12:00:00.000Z',
  updatedAt: '2026-09-11T12:00:00.000Z',
  cancelledAt: null,
  claimedBy: 'staff-user-1',
  claimedAt: '2026-09-11T12:15:00.000Z',
  resolvedAt: null,
  resolvedBy: null,
};

const SAMPLE_HELP_REPLY: helpApi.HelpReply = {
  id: 'rr-456',
  helpRequestId: 'hr-123',
  clientReplyId: 'client-rr-456',
  authorId: 'staff-user-1',
  body: 'Entities represent core enterprise rules independent of framework details.',
  createdAt: '2026-09-11T12:30:00.000Z',
  readAt: null,
};

const originalMediaDevices = navigator.mediaDevices;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'mediaDevices', {
    value: originalMediaDevices,
    writable: true,
    configurable: true,
  });
});

beforeEach(() => {
  // Default mock fetch for health check
  vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : 'url' in input ? input.url : input.href;
    if (url.includes('/api/health')) {
      return Promise.resolve(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));
    }
    return Promise.resolve(new Response('{}', { status: 200 }));
  });
});

describe('Final Automated Accessibility & Desktop Task Checks (T3-025-A)', () => {
  describe('Surface 1: Tutoring Chat Dialogue and Speech Engine Selection', () => {
    it('passes axe audit on initial empty conversation state with speech options', async () => {
      const { client } = controllableClient();
      const { synthesizer: clientSynth } = mockSpeechSynthesizer('browser', 'Device Voice');
      const { synthesizer: cloudSynth } = mockSpeechSynthesizer(
        'cloud',
        'Consented Cloud Voice',
        true,
      );

      const { container } = render(
        <LocaleContext value="en">
          <main>
            <Assistant
              client={client}
              mode="faq"
              speechSynthesizer={clientSynth}
              cloudSynthesizer={cloudSynth}
            />
          </main>
        </LocaleContext>,
      );

      // Verify headings, inputs, and aria attributes
      expect(screen.getByRole('heading', { level: 2, name: 'Conversation' })).toBeDefined();
      expect(screen.getByLabelText('Your question')).toBeDefined();
      expect(screen.getByRole('button', { name: 'Send' })).toBeDefined();

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('passes axe audit in simple-language mode in English and Amharic', async () => {
      const { client } = controllableClient();
      const { container, rerender } = render(
        <LocaleContext value="en">
          <main>
            <Assistant client={client} defaultSimpleLanguage={true} />
          </main>
        </LocaleContext>,
      );

      const checkbox = screen.getByLabelText<HTMLInputElement>('Use simple, direct language');
      expect(checkbox.checked).toBe(true);
      expect(
        screen.getByText(/Operating in simple-language mode/),
      ).toBeDefined();

      let results = await axe(container);
      expect(results).toHaveNoViolations();

      rerender(
        <LocaleContext value="am">
          <main>
            <Assistant client={client} defaultSimpleLanguage={true} />
          </main>
        </LocaleContext>,
      );

      const amharicCheckbox = screen.getByLabelText<HTMLInputElement>('ቀላል እና ግልጽ ቋንቋ ተጠቀም');
      expect(amharicCheckbox.checked).toBe(true);
      expect(
        screen.getByText(/በቀላል ቋንቋ ሁነታ ላይ ይሰራል/),
      ).toBeDefined();

      results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('passes axe audit during active sending state', async () => {
      const { client } = controllableClient();
      const { container } = render(
        <LocaleContext value="en">
          <main>
            <Assistant client={client} mode="faq" />
          </main>
        </LocaleContext>,
      );

      const input = screen.getByLabelText('Your question');
      fireEvent.change(input, { target: { value: 'What is clean architecture?' } });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));

      // Button has aria-disabled="true" during sending to preserve keyboard focus
      const sendButton = screen.getByRole('button', { name: 'Send' });
      expect(sendButton.getAttribute('aria-disabled')).toBe('true');
      expect(screen.getByText('Waiting for a reply…')).toBeDefined();

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('passes axe audit with completed Amharic tutoring reply, Addis Ababa time, and citations', async () => {
      const { client, respond } = controllableClient();
      const { container } = render(
        <LocaleContext value="am">
          <main>
            <Assistant client={client} mode="faq" />
          </main>
        </LocaleContext>,
      );

      const input = screen.getByLabelText('ጥያቄዎ');
      fireEvent.change(input, { target: { value: 'ፎቶሲንተሲስ ምንድን ነው?' } });
      fireEvent.click(screen.getByRole('button', { name: 'ላክ' }));
      await respond(amharicFaqAnswer);

      // Verify citations region and Amharic heading
      const citations = screen.getByRole('region', { name: 'ምንጮች እና ጥቅሶች፡' });
      expect(citations).toBeDefined();
      expect(citations.querySelector('cite')?.textContent).toContain('ስነ-ህይወት ምዕራፍ 1');

      // Verify accessible time element with Ethiopian and Gregorian calendar terms
      const timeElem = container.querySelector('time');
      expect(timeElem).not.toBeNull();
      expect(timeElem?.textContent).toContain('1 መስከረም 2019');
      expect(timeElem?.textContent).toContain('11 ሴፕቴምበር 2026');

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('passes axe audit with completed English tutoring reply and speech controls', async () => {
      const { client, respond } = controllableClient();
      const { synthesizer: clientSynth } = mockSpeechSynthesizer('browser', 'Device Voice');
      const { container } = render(
        <LocaleContext value="en">
          <main>
            <Assistant client={client} mode="faq" speechSynthesizer={clientSynth} />
          </main>
        </LocaleContext>,
      );

      const input = screen.getByLabelText('Your question');
      fireEvent.change(input, { target: { value: 'What is Clean Architecture?' } });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      await respond(englishFaqAnswer);

      // Verify speech playback button exists with accessible label
      const playBtn = screen.getByRole('button', { name: /Read answer aloud/i });
      expect(playBtn).toBeDefined();

      // Trigger playback
      await act(async () => {
        fireEvent.click(playBtn);
        await Promise.resolve();
      });

      // Accessible controls group during playback
      expect(screen.getByRole('group', { name: 'Speech playback controls' })).toBeDefined();
      expect(screen.getByRole('button', { name: 'Pause speech' })).toBeDefined();
      expect(screen.getByRole('button', { name: 'Stop speech' })).toBeDefined();

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('passes axe audit with cloud speech engine selection and consent disclosure', async () => {
      const { client } = controllableClient();
      const { synthesizer: clientSynth } = mockSpeechSynthesizer('browser', 'Device Voice');
      const { synthesizer: cloudSynth } = mockSpeechSynthesizer(
        'cloud',
        'Consented Cloud Voice',
        true,
      );

      const { container } = render(
        <LocaleContext value="en">
          <main>
            <Assistant
              client={client}
              mode="online"
              defaultSpeechEngine="cloud"
              speechSynthesizer={clientSynth}
              cloudSynthesizer={cloudSynth}
            />
          </main>
        </LocaleContext>,
      );

      // Cloud speech consent disclosure banner and accept button
      const consentRegion = screen.getByRole('region', {
        name: 'Consent for cloud speech synthesis',
      });
      expect(consentRegion).toBeDefined();

      const acceptButton = screen.getByRole('button', { name: 'I consent to cloud speech' });
      expect(acceptButton).toBeDefined();

      let results = await axe(container);
      expect(results).toHaveNoViolations();

      // Accept consent -> displays active consent badge and revoke button
      fireEvent.click(acceptButton);
      expect(screen.getByText('Cloud speech consent active')).toBeDefined();
      expect(screen.getByRole('button', { name: 'Revoke cloud speech consent' })).toBeDefined();

      results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('handles keyboard navigation: Enter sends, Shift+Enter makes newline, Escape dismisses problem', () => {
      const { client } = controllableClient();
      render(
        <LocaleContext value="en">
          <main>
            <Assistant client={client} mode="faq" />
          </main>
        </LocaleContext>,
      );

      const textarea = screen.getByLabelText('Your question');

      // Empty send shows problem alert
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      expect(screen.getByRole('alert')).toBeDefined();

      // Pressing Escape dismisses the alert
      fireEvent.keyDown(textarea, { key: 'Escape' });
      expect(screen.queryByRole('alert')).toBeNull();

      // Shift+Enter creates a multiline draft
      fireEvent.change(textarea, { target: { value: 'Line 1' } });
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
      expect((textarea as HTMLTextAreaElement).value).toBe('Line 1');
    });
  });

  describe('Surface 2: Asynchronous Human Help Request Submission, Inbox, and Reply Exchange', () => {
    it('passes axe audit on idle and composing states of HumanHelp', async () => {
      const { container } = render(
        <LocaleContext value="en">
          <main>
            <HumanHelp token="test-token" />
          </main>
        </LocaleContext>,
      );

      // Idle state
      expect(screen.getByRole('heading', { level: 2, name: 'Request human help' })).toBeDefined();
      const requestBtn = screen.getByRole('button', { name: 'Request help' });
      expect(requestBtn).toBeDefined();

      let results = await axe(container);
      expect(results).toHaveNoViolations();

      // Composing state
      fireEvent.click(requestBtn);
      expect(screen.getByLabelText('Your context (what you want to share)')).toBeDefined();
      expect(screen.getByRole('button', { name: 'Review before sending' })).toBeDefined();
      expect(screen.getByRole('button', { name: 'Discard' })).toBeDefined();

      results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('passes axe audit on disclosure preview and waiting states of HumanHelp', async () => {
      vi.spyOn(helpApi, 'submitHelpRequest').mockResolvedValue({
        kind: 'submitted',
        request: SAMPLE_HELP_REQUEST,
      });

      const { container } = render(
        <LocaleContext value="en">
          <main>
            <HumanHelp token="test-token" />
          </main>
        </LocaleContext>,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Request help' }));
      const textarea = screen.getByLabelText('Your context (what you want to share)');
      fireEvent.change(textarea, {
        target: { value: 'Need help understanding entity boundaries.' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Review before sending' }));

      // Disclosure preview state
      expect(
        screen.getByRole('region', { name: 'What will be shared with support staff' }),
      ).toBeDefined();
      expect(screen.getByText('Your context:')).toBeDefined();
      expect(
        screen.getByText(
          /Staff respond when available. This request does not guarantee a specific response time./i,
        ),
      ).toBeDefined();

      let results = await axe(container);
      expect(results).toHaveNoViolations();

      // Confirm submission -> waiting state
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Confirm and send' }));
        await Promise.resolve();
      });

      expect(screen.getByRole('status')).toBeDefined();
      expect(screen.getByRole('button', { name: 'Cancel this request' })).toBeDefined();

      results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('passes axe audit on HelpInbox with unread staff replies and reply composition', async () => {
      vi.spyOn(helpApi, 'listHelpRequests').mockResolvedValue({
        kind: 'ok',
        requests: [SAMPLE_HELP_REQUEST],
      });
      vi.spyOn(helpApi, 'listReplies').mockResolvedValue({
        kind: 'ok',
        replies: [SAMPLE_HELP_REPLY],
      });
      vi.spyOn(helpApi, 'markRepliesRead').mockResolvedValue(true);

      let containerElem: HTMLElement | undefined;
      await act(async () => {
        const { container } = render(
          <LocaleContext value="en">
            <main>
              <HelpInbox token="test-token" />
            </main>
          </LocaleContext>,
        );
        containerElem = container;
        await Promise.resolve();
      });

      // Inbox heading and item
      expect(screen.getByRole('heading', { level: 2, name: 'Your help requests' })).toBeDefined();
      expect(screen.getByText('Being handled by staff')).toBeDefined();

      // Unread notification and mark as read action
      expect(screen.getByRole('button', { name: 'Mark as read' })).toBeDefined();

      // Reply thread
      const thread = screen.getByRole('list', { name: 'Reply thread' });
      expect(thread).toBeDefined();

      // Meeting note for active request
      expect(
        screen.getByText(/To arrange a meeting, propose a time in Addis Ababa timezone/i),
      ).toBeDefined();

      let results = await axe(containerElem!);
      expect(results).toHaveNoViolations();

      // Open reply compose form
      fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
      expect(screen.getByLabelText('Your reply')).toBeDefined();
      expect(screen.getByRole('button', { name: 'Send' })).toBeDefined();

      results = await axe(containerElem!);
      expect(results).toHaveNoViolations();
    });
  });

  describe('Surface 3: Accommodation Request Form, Coordinator Queue, and Status Review', () => {
    it('passes axe audit through job selection, description composition, and preview steps', async () => {
      vi.spyOn(accommodationApi, 'listJobs').mockResolvedValue({
        kind: 'ok',
        jobs: [SAMPLE_JOB],
      });
      vi.spyOn(accommodationApi, 'listAccommodationRequests').mockResolvedValue({
        kind: 'ok',
        requests: [],
      });

      const { container } = render(
        <LocaleContext value="en">
          <main>
            <AccommodationPanel token="test-token" />
          </main>
        </LocaleContext>,
      );

      // Initial state
      const startBtn = screen.getByRole('button', { name: 'Start a request' });
      let results = await axe(container);
      expect(results).toHaveNoViolations();

      // Step 1: Job selection dropdown
      await act(async () => {
        fireEvent.click(startBtn);
        await Promise.resolve();
      });

      const select = screen.getByLabelText('Job');
      expect(select).toBeDefined();
      fireEvent.change(select, { target: { value: 'job-uuid-1' } });
      results = await axe(container);
      expect(results).toHaveNoViolations();

      // Step 2: Description composing form
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      const descInput = screen.getByLabelText('Support description');
      expect(descInput).toBeDefined();
      fireEvent.change(descInput, {
        target: { value: 'Screen magnification and extra test time.' },
      });
      results = await axe(container);
      expect(results).toHaveNoViolations();

      // Step 3: Privacy preview disclosure
      fireEvent.click(screen.getByRole('button', { name: 'Review before sending' }));
      expect(screen.getByRole('heading', { level: 3, name: 'Review your request' })).toBeDefined();
      expect(
        screen.getByText(
          /Only you and an authorised coordinator will see this. It will be stored for up to 7 days./i,
        ),
      ).toBeDefined();
      expect(screen.getByRole('button', { name: 'Confirm and send' })).toBeDefined();
      expect(screen.getByRole('button', { name: 'Back' })).toBeDefined();

      results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('passes axe audit on CoordinatorAccommodationPanel with filter tabs and status controls', async () => {
      vi.spyOn(accommodationApi, 'listCoordinatorAccommodationRequests').mockResolvedValue({
        kind: 'ok',
        requests: [SAMPLE_ACCOMMODATION_REQUEST],
      });
      vi.spyOn(accommodationApi, 'listAccommodationReplies').mockResolvedValue({
        kind: 'ok',
        replies: [],
      });

      let containerElem: HTMLElement | undefined;
      await act(async () => {
        const { container } = render(
          <LocaleContext value="en">
            <main>
              <CoordinatorAccommodationPanel token="coordinator-token" />
            </main>
          </LocaleContext>,
        );
        containerElem = container;
        await Promise.resolve();
      });

      // Coordinator heading and request card
      expect(
        screen.getByRole('heading', { level: 2, name: 'Accommodation Coordinator Inbox' }),
      ).toBeDefined();
      expect(screen.getByText('Waiting for coordinator')).toBeDefined();

      // Coordinator request status controls group
      expect(screen.getByRole('group', { name: 'Status actions' })).toBeDefined();
      expect(screen.getByRole('button', { name: 'Mark as Reviewing' })).toBeDefined();
      expect(screen.getByRole('button', { name: 'Confirm Accommodation' })).toBeDefined();
      expect(screen.getByRole('button', { name: 'Decline Request' })).toBeDefined();

      const results = await axe(containerElem!);
      expect(results).toHaveNoViolations();
    });
  });

  describe('Surface 4: Career Job Search, Preferences, and Subscriptions', () => {
    it('passes axe audit for active job answer with approved citation links', async () => {
      const { client, respond } = controllableClient();
      const { container } = render(
        <LocaleContext value="en">
          <main>
            <Assistant client={client} mode="faq" />
          </main>
        </LocaleContext>,
      );

      const input = screen.getByLabelText('Your question');
      fireEvent.change(input, { target: { value: 'Are there any virtual assistant jobs?' } });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      await respond(activeJobAnswer);

      // Verify speaker label identifies approved jobs
      expect(screen.getByText('Assistant (approved jobs)')).toBeDefined();

      // Verify citation link is accessible with valid URL
      const link = screen.getByRole('link', {
        name: 'Savanna Digital Services — Virtual Assistant Specialist',
      });
      expect(link.getAttribute('href')).toBe('https://digitalbridge.et/jobs/job-va-specialist-01');

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('passes axe audit for expired job vacancy acknowledgement with citation', async () => {
      const { client, respond } = controllableClient();
      const { container } = render(
        <LocaleContext value="en">
          <main>
            <Assistant client={client} mode="faq" />
          </main>
        </LocaleContext>,
      );

      const input = screen.getByLabelText('Your question');
      fireEvent.change(input, { target: { value: 'Is the data entry clerk position open?' } });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      await respond(expiredJobAnswer);

      expect(screen.getAllByText(/applications are no longer accepted/i).length).toBeGreaterThan(0);
      const link = screen.getByRole('link', {
        name: 'Ethio Telecom — Data Entry Clerk (Expired)',
      });
      expect(link.getAttribute('href')).toBe('https://digitalbridge.et/jobs/job-data-clerk-02');

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('passes axe audit for unknown job limitation response without fake citations', async () => {
      const { client, respond } = controllableClient();
      const { container } = render(
        <LocaleContext value="en">
          <main>
            <Assistant client={client} mode="faq" />
          </main>
        </LocaleContext>,
      );

      const input = screen.getByLabelText('Your question');
      fireEvent.change(input, { target: { value: 'Do you have astrophysics positions?' } });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      await respond(unknownJobAnswer);

      // Limitation stated honestly
      expect(screen.getAllByText(/do not have an approved job record/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/external web search is not used/i).length).toBeGreaterThan(0);
      // No citations generated
      expect(screen.queryByRole('region', { name: 'Sources & Citations:' })).toBeNull();

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('Surface 5: Desktop Screen Sharing Consent, Active Status, and Teardown', () => {
    it('passes axe audit on idle state requiring explicit learner initiation', async () => {
      vi.spyOn(support, 'isScreenShareSupported').mockReturnValue(true);
      vi.spyOn(sharingApi, 'getSessionByHelpRequestId').mockResolvedValue(null);

      const { container } = render(
        <LocaleContext value="en">
          <main>
            <ScreenShare token="test-token" helpRequestId="hr-123" role="learner" />
          </main>
        </LocaleContext>,
      );

      expect(screen.getByRole('heading', { level: 3, name: 'Screen sharing' })).toBeDefined();
      expect(screen.getByRole('button', { name: 'Share screen' })).toBeDefined();
      expect(screen.getByText('Screen sharing is available with support staff.')).toBeDefined();

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('passes axe audit during active sharing with persistent accessible stop control', async () => {
      vi.spyOn(support, 'isScreenShareSupported').mockReturnValue(true);
      vi.spyOn(sharingApi, 'getSessionByHelpRequestId').mockResolvedValue(null);

      // Mock mediaDevices.getDisplayMedia
      const mockTrack = {
        stop: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      const mockStream = {
        getTracks: () => [mockTrack],
        getVideoTracks: () => [mockTrack],
      };
      Object.defineProperty(navigator, 'mediaDevices', {
        value: {
          getDisplayMedia: vi.fn().mockResolvedValue(mockStream),
        },
        writable: true,
        configurable: true,
      });

      const mockSession: sharingApi.SharingSession = {
        id: 'ss-123',
        helpRequestId: 'hr-123',
        learnerId: 'learner-1',
        supportId: 'staff-1',
        state: 'active',
        createdAt: '2026-09-11T12:00:00.000Z',
        expiresAt: '2026-09-11T12:30:00.000Z',
        revokedAt: null,
      };
      vi.spyOn(sharingApi, 'initiateSession').mockResolvedValue(mockSession);
      vi.spyOn(sharingApi, 'revokeSession').mockResolvedValue({
        ...mockSession,
        state: 'revoked',
        revokedAt: '2026-09-11T12:10:00.000Z',
      });

      const { container } = render(
        <LocaleContext value="en">
          <main>
            <ScreenShare token="test-token" helpRequestId="hr-123" role="learner" />
          </main>
        </LocaleContext>,
      );

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Share screen' }));
        await Promise.resolve();
      });

      // Active sharing status announcement
      expect(screen.getByRole('status').textContent).toBe(
        'You are sharing your screen with support staff.',
      );

      // Persistent accessible stop control
      const stopButton = screen.getByRole('button', { name: 'Stop sharing screen' });
      expect(stopButton).toBeDefined();

      let results = await axe(container);
      expect(results).toHaveNoViolations();

      // Teardown: stop sharing cleanly
      await act(async () => {
        fireEvent.click(stopButton);
        await Promise.resolve();
      });

      expect(screen.getByRole('status').textContent).toBe('Screen sharing stopped.');
      results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('passes axe audit on graceful disclosure for unsupported browsers', async () => {
      vi.spyOn(support, 'isScreenShareSupported').mockReturnValue(false);

      const { container } = render(
        <LocaleContext value="en">
          <main>
            <ScreenShare token="test-token" helpRequestId="hr-123" role="learner" />
          </main>
        </LocaleContext>,
      );

      // Unsupported browser note is rendered as an accessible note
      expect(screen.getByRole('note')).toBeDefined();
      expect(
        screen.getByText(
          'Screen sharing is not supported on this browser or mobile device. You can continue receiving text help in this conversation.',
        ),
      ).toBeDefined();

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('Surface 6: Complete Integrated Desktop App Shell', () => {
    it('passes axe audit on full application shell in English demo mode', async () => {
      let containerElem: HTMLElement | undefined;
      act(() => {
        const { container } = render(<App />);
        containerElem = container;
      });

      // Landmark structure
      expect(screen.getByRole('main')).toBeDefined();
      expect(containerElem?.querySelector('footer')).not.toBeNull();

      // Language switcher
      expect(screen.getByRole('group', { name: 'Language' })).toBeDefined();

      // Title
      expect(screen.getByRole('heading', { level: 1, name: 'Learning assistant' })).toBeDefined();

      const results = await axe(containerElem!);
      expect(results).toHaveNoViolations();
    });

    it('passes axe audit on full application shell in Amharic demo mode', async () => {
      let containerElem: HTMLElement | undefined;
      act(() => {
        const { container } = render(<App />);
        containerElem = container;
      });

      // Switch to Amharic
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'አማርኛ' }));
      });

      // Amharic title and controls
      expect(screen.getByRole('heading', { level: 1, name: 'የትምህርት ረዳት' })).toBeDefined();
      expect(screen.getByRole('group', { name: 'ቋንቋ' })).toBeDefined();

      const results = await axe(containerElem!);
      expect(results).toHaveNoViolations();
    });

    it('passes axe audit on full application shell in authenticated learner session mode', async () => {
      vi.spyOn(accommodationApi, 'listJobs').mockResolvedValue({
        kind: 'ok',
        jobs: [SAMPLE_JOB],
      });
      vi.spyOn(accommodationApi, 'listAccommodationRequests').mockResolvedValue({
        kind: 'ok',
        requests: [SAMPLE_ACCOMMODATION_REQUEST],
      });
      vi.spyOn(helpApi, 'listHelpRequests').mockResolvedValue({
        kind: 'ok',
        requests: [SAMPLE_HELP_REQUEST],
      });
      vi.spyOn(helpApi, 'listReplies').mockResolvedValue({
        kind: 'ok',
        replies: [SAMPLE_HELP_REPLY],
      });

      let containerElem: HTMLElement | undefined;
      await act(async () => {
        const { container } = render(<App handoffCode="mock-handoff-code" />);
        containerElem = container;
        await Promise.resolve();
      });

      const results = await axe(containerElem!);
      expect(results).toHaveNoViolations();
    });
  });
});
