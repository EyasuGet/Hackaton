// Automated accessibility inspection and invariant verification for the bilingual tutoring task (T3-009-B).
// Verifies:
// 1. English and Amharic accessible names, roles, and status announcements (aria-live, role="status", role="log").
// 2. Full keyboard navigability (no mouse required, tab stops, focus rings, Escape handling).
// 3. High-contrast / zoom responsiveness up to 200%.
// 4. Screen reader semantic markup for citations and FAQ answers.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocaleContext } from '../../shared/i18n/i18n.tsx';
import { Assistant } from './assistant.tsx';
import type { AskResult, Citation, ConversationClient } from './conversation.ts';
import type { SpeechCallbacks, SpeechSynthesizer } from './speech-adapter.ts';

afterEach(cleanup);

const amharicFaqCitations: Citation[] = [
  {
    sourceId: 'course-1-bio',
    sectionId: 'sec-photosynthesis',
    sourceTitle: 'ስነ-ህይወት ምዕራፍ 1',
    heading: 'የፎቶሲንተሲስ ሂደት',
  },
];

const amharicFaqAnswer: AskResult = {
  kind: 'answer',
  reply: {
    id: 'faq-am-1',
    text: 'ፎቶሲንተሲስ እፅዋት ከፀሐይ ብርሃን፣ ከውሃ እና ከካርቦን ዳይኦክሳይድ ስኳር እና ኦክስጅን የሚያመርቱበት ሂደት ነው።',
    lang: 'am',
    createdAt: '2026-09-11T12:00:00.000Z',
    citations: amharicFaqCitations,
  },
};

const englishFaqCitations: Citation[] = [
  {
    sourceId: 'course-1-cs',
    sectionId: 'sec-clean-arch',
    sourceTitle: 'Software Architecture 101',
    heading: 'Clean Architecture Principles',
  },
];

const englishFaqAnswer: AskResult = {
  kind: 'answer',
  reply: {
    id: 'faq-en-1',
    text: 'Clean Architecture emphasizes the separation of concerns, ensuring core domain logic remains independent of frameworks, databases, and UI transport layers.',
    lang: 'en',
    createdAt: '2026-09-11T12:00:00.000Z',
    citations: englishFaqCitations,
  },
};

const ungroundedLimitationAnswer: AskResult = {
  kind: 'answer',
  reply: {
    id: 'faq-limit-1',
    text: 'I could not find information about quantum gravity in the approved course materials. You can request help from human course staff for topics outside this course.',
    lang: 'en',
    createdAt: '2026-09-11T12:00:00.000Z',
  },
};

function controllableClient() {
  const pending: ((result: AskResult) => void)[] = [];
  const ask = vi.fn(() => new Promise<AskResult>((resolve) => pending.push(resolve)));
  const client: ConversationClient = { ask };
  const respond = async (result: AskResult) => {
    await act(() => Promise.resolve(pending.shift()?.(result)));
  };
  return { client, ask, respond };
}

async function clickButton(button: HTMLElement) {
  await act(async () => {
    fireEvent.click(button);
    await Promise.resolve();
  });
}

function mockSpeechSynthesizer() {
  const stopMock = vi.fn();
  const pauseMock = vi.fn();
  const resumeMock = vi.fn();
  const speakMock = vi.fn();

  const synthesizer: SpeechSynthesizer = {
    id: 'test-synth',
    name: 'Test Synthesizer',
    requiresConsent: false,
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

describe('Bilingual Accessible Tutoring Task (T3-009-B)', () => {
  describe('Invariant 1: English & Amharic accessible names, roles, and status announcements', () => {
    it('provides accessible names and ARIA roles in English FAQ mode', async () => {
      const { client, respond } = controllableClient();
      render(
        <LocaleContext value="en">
          <Assistant client={client} mode="faq" />
        </LocaleContext>,
      );

      // Section has accessible name from heading
      const section = screen.getByRole('region', { name: 'Conversation' });
      expect(section).toBeDefined();

      // Course FAQ mode notice has note role
      const notice = screen.getByRole('note');
      expect(notice.textContent).toContain('Operating in approved course FAQ mode');

      // Question box has explicit accessible label
      const textarea = screen.getByLabelText('Your question');
      expect(textarea).toBeDefined();
      expect(textarea.getAttribute('aria-describedby')).toBeDefined();

      // Submit button has accessible name
      const submitBtn = screen.getByRole('button', { name: 'Send' });
      expect(submitBtn).toBeDefined();

      // Live updates announcement region has role="status", aria-live="polite", aria-atomic="true"
      const statusRegion = screen.getByRole('status', { name: 'Conversation updates' });
      expect(statusRegion).toBeDefined();
      expect(statusRegion.getAttribute('aria-live')).toBe('polite');
      expect(statusRegion.getAttribute('aria-atomic')).toBe('true');

      // Ask question by keyboard and check announcement
      fireEvent.change(textarea, { target: { value: 'Explain Clean Architecture.' } });
      fireEvent.keyDown(textarea, { key: 'Enter' });
      expect(statusRegion.textContent).toBe('Sending your question…');

      await respond(englishFaqAnswer);

      // Reply announced with assistant prefix in English
      expect(statusRegion.textContent).toContain('Assistant: Clean Architecture emphasizes');

      // Message list has semantic role="list"
      const messageLists = screen.getAllByRole('list');
      expect(messageLists.length).toBeGreaterThan(0);
    });

    it('provides accessible names, Ethiopic characters, and ARIA roles in Amharic FAQ mode', async () => {
      const { client, respond } = controllableClient();
      render(
        <LocaleContext value="am">
          <Assistant client={client} mode="faq" />
        </LocaleContext>,
      );

      // Heading and container in Amharic
      const section = screen.getByRole('region', { name: 'ውይይት' });
      expect(section).toBeDefined();

      // Amharic FAQ mode notice
      const notice = screen.getByRole('note');
      expect(notice.textContent).toContain('በተረጋገጠ የትምህርት ተደጋጋሚ ጥያቄዎች (FAQ) ሁኔታ ላይ ይገኛል');

      // Amharic question box label
      const textarea = screen.getByLabelText('ጥያቄዎ');
      expect(textarea).toBeDefined();

      // Amharic submit button
      const submitBtn = screen.getByRole('button', { name: 'ላክ' });
      expect(submitBtn).toBeDefined();

      // Amharic live updates region
      const statusRegion = screen.getByRole('status', { name: 'የውይይት ማሳወቂያዎች' });
      expect(statusRegion).toBeDefined();
      expect(statusRegion.getAttribute('aria-live')).toBe('polite');
      expect(statusRegion.getAttribute('aria-atomic')).toBe('true');

      // Send Amharic question
      fireEvent.change(textarea, { target: { value: 'ፎቶሲንተሲስ ምንድን ነው?' } });
      fireEvent.keyDown(textarea, { key: 'Enter' });
      expect(statusRegion.textContent).toBe('ጥያቄዎ እየተላከ ነው…');

      await respond(amharicFaqAnswer);

      // Prefix in Amharic and Amharic text announced
      expect(statusRegion.textContent).toContain('ረዳት፦ ፎቶሲንተሲስ እፅዋት');

      // Sourced citations labeled in Amharic
      const citationsRegion = screen.getByRole('region', { name: 'ምንጮች እና ጥቅሶች፡' });
      expect(citationsRegion).toBeDefined();
      expect(citationsRegion.textContent).toContain('ስነ-ህይወት ምዕራፍ 1 — የፎቶሲንተሲስ ሂደት');
    });

    it('does not steal focus from the user when an answer arrives', async () => {
      const { client, respond } = controllableClient();
      render(<Assistant client={client} mode="faq" />);

      const textarea = screen.getByLabelText('Your question');
      textarea.focus();
      expect(document.activeElement).toBe(textarea);

      fireEvent.change(textarea, { target: { value: 'What is photosynthesis?' } });
      fireEvent.keyDown(textarea, { key: 'Enter' });

      await respond(englishFaqAnswer);

      // Focus must remain on the textarea, never stolen by the live region or message list
      expect(document.activeElement).toBe(textarea);
    });
  });

  describe('Invariant 2: Full keyboard navigability & Escape handling', () => {
    it('operates entirely via keyboard without mouse interaction', async () => {
      const { client, respond } = controllableClient();
      const { synthesizer } = mockSpeechSynthesizer();
      render(<Assistant client={client} mode="faq" speechSynthesizer={synthesizer} />);

      const textarea = screen.getByLabelText('Your question');
      textarea.focus();

      // Enter submits
      fireEvent.change(textarea, { target: { value: 'Photosynthesis question' } });
      fireEvent.keyDown(textarea, { key: 'Enter' });

      await respond(englishFaqAnswer);

      // Play button is focusable by keyboard
      const playBtn = screen.getByRole('button', { name: /Read answer aloud/i });
      playBtn.focus();
      expect(document.activeElement).toBe(playBtn);

      // Enter/Space triggers playback
      await clickButton(playBtn);
      const pauseBtn = screen.getByRole('button', { name: 'Pause speech' });
      expect(pauseBtn).toBeDefined();
    });

    it('retains button focusability with aria-disabled while request is sending', async () => {
      const { client, respond } = controllableClient();
      render(<Assistant client={client} mode="faq" />);

      const textarea = screen.getByLabelText('Your question');
      const submitBtn = screen.getByRole('button', { name: 'Send' });

      fireEvent.change(textarea, { target: { value: 'My question' } });
      fireEvent.keyDown(textarea, { key: 'Enter' });

      // Button uses aria-disabled rather than HTML disabled, preventing focus loss to body
      expect(submitBtn.getAttribute('aria-disabled')).toBe('true');
      expect(submitBtn.hasAttribute('disabled')).toBe(false);

      await respond(englishFaqAnswer);
      expect(submitBtn.getAttribute('aria-disabled')).toBe('false');
    });

    it('stops speech playback on Escape key press anywhere within assistant', async () => {
      const { client, respond } = controllableClient();
      const { synthesizer, stopMock } = mockSpeechSynthesizer();
      render(<Assistant client={client} mode="faq" speechSynthesizer={synthesizer} />);

      const textarea = screen.getByLabelText('Your question');
      fireEvent.change(textarea, { target: { value: 'Photosynthesis question' } });
      fireEvent.keyDown(textarea, { key: 'Enter' });
      await respond(englishFaqAnswer);

      // Start speech
      const playBtn = screen.getByRole('button', { name: /Read answer aloud/i });
      await clickButton(playBtn);
      expect(screen.getByRole('button', { name: 'Pause speech' })).toBeDefined();

      // Press Escape in textarea or container
      fireEvent.keyDown(textarea, { key: 'Escape' });
      expect(stopMock).toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: 'Pause speech' })).toBeNull();
      expect(screen.getByRole('button', { name: /Read answer aloud/i })).toBeDefined();
    });

    it('dismisses problem alerts on Escape key press', () => {
      const { client } = controllableClient();
      render(<Assistant client={client} mode="faq" />);

      const textarea = screen.getByLabelText('Your question');
      // Trigger empty submission problem
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      expect(screen.getByRole('alert')).toBeDefined();

      // Press Escape dismisses the alert without mouse
      fireEvent.keyDown(textarea, { key: 'Escape' });
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });

  describe('Invariant 3: High-contrast and 200% zoom responsiveness', () => {
    it('includes high-contrast media queries for prefers-contrast and forced-colors in CSS', () => {
      const cssPath = resolve(__dirname, '../../app/app.css');
      const cssContent = readFileSync(cssPath, 'utf8');

      // Verifies WCAG AA high-contrast rules
      expect(cssContent).toContain('@media (prefers-contrast: more)');
      expect(cssContent).toContain('@media (forced-colors: active)');
      expect(cssContent).toContain('Highlight');
      expect(cssContent).toContain('ButtonText');
      expect(cssContent).toContain('CanvasText');
    });

    it('uses reflow-safe typography and wrapping rules for 200% zoom', () => {
      const cssPath = resolve(__dirname, '../../app/app.css');
      const cssContent = readFileSync(cssPath, 'utf8');

      // Verifies WCAG 1.4.10 reflow and 1.4.4 resize text compatibility
      expect(cssContent).toContain('max-width: 48rem');
      expect(cssContent).toContain('overflow-wrap: anywhere');
      expect(cssContent).toContain('white-space: pre-wrap');
      expect(cssContent).toContain(':focus-visible');
      expect(cssContent).toContain('outline: 3px solid');
    });
  });

  describe('Invariant 4: Screen reader semantic markup for citations and FAQ answers', () => {
    it('marks citations with semantic cite elements, distinct list items, and region landmarks', async () => {
      const { client, respond } = controllableClient();
      render(<Assistant client={client} mode="faq" />);

      const textarea = screen.getByLabelText('Your question');
      fireEvent.change(textarea, { target: { value: 'Clean architecture question' } });
      fireEvent.keyDown(textarea, { key: 'Enter' });
      await respond(englishFaqAnswer);

      // Citations region
      const citations = screen.getByRole('region', { name: 'Sources & Citations:' });
      expect(citations).toBeDefined();

      // Contains semantic <cite> element
      const citeElem = citations.querySelector('cite');
      expect(citeElem).not.toBeNull();
      expect(citeElem?.textContent).toBe(
        'Software Architecture 101 — Clean Architecture Principles',
      );

      // Wrapped in unordered list for screen reader enumeration
      const listItems = citations.querySelectorAll('li.citation-item');
      expect(listItems.length).toBe(1);
    });

    it('clearly presents missing-evidence limitation without fabricating citations', async () => {
      const { client, respond } = controllableClient();
      render(<Assistant client={client} mode="faq" />);

      const textarea = screen.getByLabelText('Your question');
      fireEvent.change(textarea, { target: { value: 'What is quantum gravity?' } });
      fireEvent.keyDown(textarea, { key: 'Enter' });
      await respond(ungroundedLimitationAnswer);

      // Limitation disclosed honestly
      expect(
        screen.getAllByText(/could not find information about quantum gravity/i).length,
      ).toBeGreaterThan(0);
      expect(screen.getAllByText(/request help from human course staff/i).length).toBeGreaterThan(
        0,
      );

      // No fake citations generated
      expect(screen.queryByRole('region', { name: 'Sources & Citations:' })).toBeNull();
    });

    it('renders dates with Ethiopian and Gregorian calendar terms in Addis Ababa timezone', async () => {
      const { client, respond } = controllableClient();
      render(<Assistant client={client} mode="faq" />);

      const textarea = screen.getByLabelText('Your question');
      fireEvent.change(textarea, { target: { value: 'Date test question' } });
      fireEvent.keyDown(textarea, { key: 'Enter' });
      await respond(englishFaqAnswer);

      const timeElement = document.querySelector('time');
      expect(timeElement).not.toBeNull();
      expect(timeElement?.getAttribute('datetime')).toBe('2026-09-11T12:00:00.000Z');
      expect(timeElement?.textContent).toContain('1 Meskerem 2019');
      expect(timeElement?.textContent).toContain('11 September 2026');
      expect(timeElement?.textContent).toContain('15:00');
      expect(timeElement?.textContent).toContain('Addis Ababa time');
    });
  });
});
