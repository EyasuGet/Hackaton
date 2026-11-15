import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocaleContext } from '../../shared/i18n/i18n.tsx';
import { Assistant } from './assistant.tsx';
import type { AskResult, ConversationClient } from './conversation.ts';
import {
  BrowserSpeechSynthesizer,
  CloudSpeechSynthesizer,
  type SpeechCallbacks,
  type SpeechSynthesizer,
} from './speech-adapter.ts';

afterEach(cleanup);

const englishAnswer: AskResult = {
  kind: 'answer',
  reply: {
    id: 'r1',
    text: 'Photosynthesis makes sugar.',
    lang: 'en',
    createdAt: '2026-09-11T12:00:00.000Z',
  },
};

const citedEnglishAnswer: AskResult = {
  kind: 'answer',
  reply: {
    id: 'r-cited',
    text: 'Photosynthesis makes sugar.',
    lang: 'en',
    createdAt: '2026-09-11T12:00:00.000Z',
    citations: [
      {
        sourceId: 'bio-1',
        sectionId: 'sec-1',
        sourceTitle: 'Biology Basics',
        heading: 'Photosynthesis Section',
      },
    ],
  },
};

function controllableSpeechSynthesizer(options?: {
  isSupported?: boolean | ((lang: string) => boolean);
  fail?: boolean;
}) {
  const isSupportedFn = (lang: string): boolean => {
    if (typeof options?.isSupported === 'function') {
      return options.isSupported(lang);
    }
    return options?.isSupported ?? true;
  };

  const speakMock = vi.fn();
  const pauseMock = vi.fn();
  const resumeMock = vi.fn();
  const stopMock = vi.fn();
  let lastCallbacks: SpeechCallbacks | undefined;

  const synthesizer: SpeechSynthesizer = {
    id: 'test-synth',
    name: 'Test Synthesizer',
    requiresConsent: false,
    isSupported: vi.fn((lang: string): boolean => isSupportedFn(lang)),
    speak: vi.fn(
      (text: string, opts: { lang: string; signal?: AbortSignal }, callbacks?: SpeechCallbacks) => {
        speakMock(text, opts);
        lastCallbacks = callbacks;
        if (options?.fail) {
          callbacks?.onError?.(new Error('Synthetic speech engine failure'));
          return Promise.resolve({
            pause: pauseMock,
            resume: resumeMock,
            stop: stopMock,
            state: 'idle' as const,
          });
        }
        callbacks?.onStart?.();
        return Promise.resolve({
          pause: () => {
            pauseMock();
            callbacks?.onPause?.();
          },
          resume: () => {
            resumeMock();
            callbacks?.onResume?.();
          },
          stop: () => {
            stopMock();
            callbacks?.onEnd?.();
          },
          state: 'playing' as const,
        });
      },
    ),
  };

  return {
    synthesizer,
    speakMock,
    pauseMock,
    resumeMock,
    stopMock,
    triggerEnd: () => lastCallbacks?.onEnd?.(),
    triggerError: (err: Error) => lastCallbacks?.onError?.(err),
  };
}

/** A client whose replies the test releases explicitly, to observe the pending state. */
function controllableClient() {
  const pending: ((result: AskResult) => void)[] = [];
  const ask = vi.fn(() => new Promise<AskResult>((resolve) => pending.push(resolve)));
  const client: ConversationClient = { ask };
  const respond = async (result: AskResult) => {
    await act(() => Promise.resolve(pending.shift()?.(result)));
  };
  return { client, ask, respond };
}

const questionBox = () => screen.getByLabelText('Your question');
const updates = () => screen.getByRole('status', { name: 'Conversation updates' });

function type(text: string) {
  fireEvent.change(questionBox(), { target: { value: text } });
}

describe('Assistant', () => {
  it('sends on Enter, shows the exchange, clears the box and keeps focus there', async () => {
    const { client, ask, respond } = controllableClient();
    render(<Assistant client={client} />);
    questionBox().focus();
    type('  What is photosynthesis?  ');

    fireEvent.keyDown(questionBox(), { key: 'Enter' });
    expect(ask).toHaveBeenCalledWith('What is photosynthesis?');
    expect(updates().textContent).toBe('Sending your question…');

    await respond(englishAnswer);

    const messages = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(messages[0]).toBe('YouWhat is photosynthesis?');
    expect(messages[1]).toContain('Assistant (demo)Photosynthesis makes sugar.');
    expect(questionBox()).toHaveProperty('value', '');
    expect(document.activeElement).toBe(questionBox());
    expect(updates().textContent).toBe('Assistant: Photosynthesis makes sugar.');
  });

  it('shows the reply instant in Ethiopian and Gregorian calendars and Addis Ababa time', async () => {
    const { client, respond } = controllableClient();
    const { container } = render(<Assistant client={client} />);
    type('Question');

    fireEvent.keyDown(questionBox(), { key: 'Enter' });
    await respond(englishAnswer);

    const time = container.querySelector('time');
    expect(time?.getAttribute('datetime')).toBe('2026-09-11T12:00:00.000Z');
    expect(time?.textContent).toContain('1 Meskerem 2019');
    expect(time?.textContent).toContain('Ethiopian calendar');
    expect(time?.textContent).toContain('11 September 2026');
    expect(time?.textContent).toContain('Gregorian');
    expect(time?.textContent).toContain('15:00');
    expect(time?.textContent).toContain('Addis Ababa time');
  });

  it('still shows a reply when its timestamp cannot be presented', async () => {
    const { client, respond } = controllableClient();
    const { container } = render(<Assistant client={client} />);
    type('Question');

    fireEvent.keyDown(questionBox(), { key: 'Enter' });
    await respond({
      kind: 'answer',
      reply: { id: 'r3', text: 'Visible reply', lang: 'en', createdAt: 'not-a-date' },
    });

    expect(screen.getAllByRole('listitem')[1]?.textContent).toContain('Visible reply');
    expect(container.querySelector('time')).toBeNull();
  });

  it.each([
    ['Shift+Enter', { key: 'Enter', shiftKey: true }],
    ['Enter while an input method is composing', { key: 'Enter', isComposing: true }],
  ])('does not send on %s', (_case, keyEvent) => {
    const { client, ask } = controllableClient();
    render(<Assistant client={client} />);
    type('ሰላም');

    fireEvent.keyDown(questionBox(), keyEvent);

    expect(ask).not.toHaveBeenCalled();
  });

  it('ignores further sends while a question is pending', async () => {
    const { client, ask, respond } = controllableClient();
    render(<Assistant client={client} />);
    type('Question');

    fireEvent.keyDown(questionBox(), { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    fireEvent.keyDown(questionBox(), { key: 'Enter' });

    expect(ask).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Send' }).getAttribute('aria-disabled')).toBe('true');
    await respond(englishAnswer);
    expect(screen.getByRole('button', { name: 'Send' }).getAttribute('aria-disabled')).toBe(
      'false',
    );
  });

  it.each([
    ['failed', 'could not be sent'],
    ['denied', 'session has expired'],
  ] as const)('keeps the question and explains a %s request', async (kind, message) => {
    const { client, ask, respond } = controllableClient();
    render(<Assistant client={client} />);
    type('Keep me');

    fireEvent.keyDown(questionBox(), { key: 'Enter' });
    await respond({ kind });

    expect(screen.getByRole('alert').textContent).toContain(message);
    expect(questionBox()).toHaveProperty('value', 'Keep me');
    expect(screen.queryByRole('listitem')).toBeNull();

    // An intentional retry sends the same question again.
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await respond(englishAnswer);
    expect(ask).toHaveBeenNthCalledWith(2, 'Keep me');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('asks for a question instead of sending an empty one', () => {
    const { client, ask } = controllableClient();
    render(<Assistant client={client} />);
    type('   ');

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(ask).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('Type a question before sending.');
    expect(questionBox().getAttribute('aria-invalid')).toBe('true');

    type('Now a real question');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(questionBox().getAttribute('aria-invalid')).toBeNull();
  });

  it('recovers when the client rejects instead of reporting a failure', async () => {
    const ask = vi.fn(() => Promise.reject(new Error('unexpected')));
    render(<Assistant client={{ ask }} />);
    type('Question');

    fireEvent.keyDown(questionBox(), { key: 'Enter' });

    expect((await screen.findByRole('alert')).textContent).toContain('could not be sent');
    expect(questionBox()).toHaveProperty('readOnly', false);
    expect(screen.getByRole('button', { name: 'Send' }).getAttribute('aria-disabled')).toBe(
      'false',
    );
  });

  it('renders markup in replies as inert text with its language and direction', async () => {
    const markup = '<img src="x" onerror="alert(1)"><script>alert(2)</script>';
    const { client, respond } = controllableClient();
    const { container } = render(<Assistant client={client} />);
    type('Question');

    fireEvent.keyDown(questionBox(), { key: 'Enter' });
    await respond({
      kind: 'answer',
      reply: {
        id: 'r2',
        text: markup,
        lang: 'am',
        createdAt: '2026-09-11T12:00:00.000Z',
      },
    });

    expect(container.querySelector('img, script')).toBeNull();
    expect(screen.getAllByText(markup).length).toBeGreaterThan(0);
    const replyText = screen.getAllByRole('listitem')[1]?.querySelector('[dir]');
    expect(replyText?.getAttribute('lang')).toBe('am');
    expect(replyText?.getAttribute('dir')).toBe('auto');
    expect(screen.getByText('1 መስከረም 2019').getAttribute('lang')).toBe('am');
    // The interface-language prefix and the Amharic reply are tagged separately.
    const spans = [...updates().querySelectorAll('span')];
    expect(spans.map((span) => [span.textContent, span.getAttribute('lang')])).toEqual([
      ['Assistant: ', 'en'],
      [markup, 'am'],
    ]);
  });

  it('announces a reply that arrives after a language switch in the new language', async () => {
    const { client, respond } = controllableClient();
    const { rerender } = render(
      <LocaleContext value="en">
        <Assistant client={client} />
      </LocaleContext>,
    );
    type('Question');
    fireEvent.keyDown(questionBox(), { key: 'Enter' });

    rerender(
      <LocaleContext value="am">
        <Assistant client={client} />
      </LocaleContext>,
    );
    await respond(englishAnswer);

    const prefix = screen.getByRole('status', { name: 'የውይይት ማሳወቂያዎች' }).querySelector('span');
    expect([prefix?.textContent, prefix?.getAttribute('lang')]).toEqual(['ረዳት፦ ', 'am']);
  });

  it('renders online mode notice and labels assistant as online AI in mode="online"', async () => {
    const { client, respond } = controllableClient();
    render(<Assistant client={client} mode="online" />);

    expect(screen.getByRole('note').textContent).toContain(
      'Operating in consented online answer mode',
    );

    type('What is an AI task?');
    fireEvent.keyDown(questionBox(), { key: 'Enter' });
    await respond({
      kind: 'answer',
      reply: {
        id: 'r-online-1',
        text: 'AI tools assist with drafting notes [artificial-intelligence-and-the-future-of-va-work].',
        lang: 'en',
        createdAt: '2026-09-11T12:00:00.000Z',
        provider: 'online',
      },
    });

    const messages = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(messages[1]).toContain('Assistant (online AI)');
  });

  it('renders consent toggle and switches mode without losing the typed question', () => {
    const { client } = controllableClient();
    const onConsentChange = vi.fn();
    const { rerender } = render(
      <Assistant client={client} mode="faq" consent={false} onConsentChange={onConsentChange} />,
    );

    const checkbox = screen.getByLabelText<HTMLInputElement>(
      'Allow external AI processing for course questions',
    );
    expect(checkbox.checked).toBe(false);
    expect(screen.getByRole('note').textContent).toContain('Operating in approved course FAQ mode');

    type('Unsent question remains intact');
    fireEvent.click(checkbox);
    expect(onConsentChange).toHaveBeenCalledWith(true);

    // Parent rerenders with consent=true and mode="online"
    rerender(
      <Assistant client={client} mode="online" consent={true} onConsentChange={onConsentChange} />,
    );

    expect(checkbox.checked).toBe(true);
    expect(screen.getByRole('note').textContent).toContain(
      'Operating in consented online answer mode',
    );
    expect(questionBox()).toHaveProperty('value', 'Unsent question remains intact');
  });

  describe('Spoken answers (T3-011)', () => {
    async function clickButton(button: HTMLElement) {
      await act(async () => {
        fireEvent.click(button);
        await Promise.resolve();
      });
    }

    it('starts speech playback only on learner action, never autoplaying', async () => {
      const { client, respond } = controllableClient();
      const { synthesizer, speakMock } = controllableSpeechSynthesizer();
      render(<Assistant client={client} speechSynthesizer={synthesizer} />);

      type('What is photosynthesis?');
      fireEvent.keyDown(questionBox(), { key: 'Enter' });
      await respond(citedEnglishAnswer);

      // Playback must not start automatically on reply arrival
      expect(speakMock).not.toHaveBeenCalled();

      // Keyboard-operable play button exists
      const playButton = screen.getByRole('button', { name: /Read answer aloud/i });
      expect(playButton).toBeDefined();

      // Starts only on deliberate learner action
      await clickButton(playButton);
      expect(speakMock).toHaveBeenCalledTimes(1);
      expect(speakMock).toHaveBeenCalledWith('Photosynthesis makes sugar.', { lang: 'en' });
    });

    it('provides keyboard-operable play, pause, resume, and stop controls', async () => {
      const { client, respond } = controllableClient();
      const { synthesizer, pauseMock, resumeMock, stopMock } = controllableSpeechSynthesizer();
      render(<Assistant client={client} speechSynthesizer={synthesizer} />);

      type('What is photosynthesis?');
      fireEvent.keyDown(questionBox(), { key: 'Enter' });
      await respond(englishAnswer);

      // 1. Play
      const playButton = screen.getByRole('button', { name: /Read answer aloud/i });
      await clickButton(playButton);

      expect(screen.getByRole('button', { name: 'Pause speech' })).toBeDefined();
      expect(screen.getByRole('button', { name: 'Stop speech' })).toBeDefined();
      expect(screen.getByText('Playing audio…')).toBeDefined();

      // 2. Pause
      await clickButton(screen.getByRole('button', { name: 'Pause speech' }));
      expect(pauseMock).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: 'Resume speech' })).toBeDefined();
      expect(screen.getByText('Audio paused')).toBeDefined();

      // 3. Resume
      await clickButton(screen.getByRole('button', { name: 'Resume speech' }));
      expect(resumeMock).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: 'Pause speech' })).toBeDefined();
      expect(screen.getByText('Playing audio…')).toBeDefined();

      // 4. Stop
      await clickButton(screen.getByRole('button', { name: 'Stop speech' }));
      expect(stopMock).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: /Read answer aloud/i })).toBeDefined();
    });

    it('stops speech playback on window navigation and component unmount', async () => {
      const { client, respond } = controllableClient();
      const { synthesizer, stopMock } = controllableSpeechSynthesizer();
      const { unmount } = render(<Assistant client={client} speechSynthesizer={synthesizer} />);

      type('Question');
      fireEvent.keyDown(questionBox(), { key: 'Enter' });
      await respond(englishAnswer);

      await clickButton(screen.getByRole('button', { name: /Read answer aloud/i }));
      expect(screen.getByRole('button', { name: 'Pause speech' })).toBeDefined();

      // Navigation event (popstate) stops playback
      fireEvent(window, new Event('popstate'));
      expect(stopMock).toHaveBeenCalledTimes(1);

      // Starting playback again and unmounting also calls stop
      await clickButton(screen.getByRole('button', { name: /Read answer aloud/i }));
      unmount();
      expect(stopMock).toHaveBeenCalledTimes(2);
    });

    it('stops ongoing speech and does not obscure new-message announcements when a new reply arrives', async () => {
      const { client, respond } = controllableClient();
      const { synthesizer, stopMock } = controllableSpeechSynthesizer();
      render(<Assistant client={client} speechSynthesizer={synthesizer} />);

      // First question & answer
      type('First question');
      fireEvent.keyDown(questionBox(), { key: 'Enter' });
      await respond(englishAnswer);

      // Start reading answer 1 aloud
      await clickButton(screen.getByRole('button', { name: /Read answer aloud/i }));
      expect(screen.getByText('Playing audio…')).toBeDefined();

      // Second question sent and received
      type('Second question');
      fireEvent.keyDown(questionBox(), { key: 'Enter' });
      await respond({
        kind: 'answer',
        reply: {
          id: 'r2',
          text: 'Second answer arrived.',
          lang: 'en',
          createdAt: '2026-09-11T12:01:00.000Z',
        },
      });

      // Ongoing playback stopped immediately so it does not obscure announcements
      expect(stopMock).toHaveBeenCalled();
      // Conversation update polite announcement contains the second reply
      expect(updates().textContent).toBe('Assistant: Second answer arrived.');
    });

    it('enforces consent for cloud speech synthesis before sending text, and respects consent changes', async () => {
      const { client, respond } = controllableClient();
      const cloudSpeakMock = vi.fn();
      const cloudSynth: SpeechSynthesizer = {
        id: 'cloud',
        name: 'Cloud Synthesizer',
        requiresConsent: true,
        isSupported: () => true,
        speak: vi.fn((text, opts) => {
          cloudSpeakMock(text, opts);
          return Promise.resolve({
            pause: () => {},
            resume: () => {},
            stop: () => {},
            state: 'playing' as const,
          });
        }),
      };

      const onConsentChange = vi.fn();
      render(
        <Assistant
          client={client}
          cloudSynthesizer={cloudSynth}
          defaultSpeechEngine="cloud"
          defaultCloudConsent={false}
          onCloudConsentChange={onConsentChange}
        />,
      );

      type('Question');
      fireEvent.keyDown(questionBox(), { key: 'Enter' });
      await respond(citedEnglishAnswer);

      // Unconsented cloud synthesis shows disclosure
      expect(
        screen.getByText(
          /Cloud speech synthesis sends the answer text to an external speech provider/i,
        ),
      ).toBeDefined();

      // Attempting to read aloud without consent warns learner and blocks cloud provider call
      await clickButton(screen.getByRole('button', { name: /Read answer aloud/i }));
      expect(cloudSpeakMock).not.toHaveBeenCalled();
      expect(
        screen.getByRole('alert', {
          name: '',
        }).textContent,
      ).toContain('Cloud speech synthesis requires your explicit consent');

      // Citations and text remain completely visible
      expect(screen.getAllByText('Photosynthesis makes sugar.').length).toBeGreaterThan(0);
      expect(screen.getByText(/Biology Basics — Photosynthesis Section/)).toBeDefined();

      // Explicit learner consent
      await clickButton(screen.getByRole('button', { name: 'I consent to cloud speech' }));
      expect(onConsentChange).toHaveBeenCalledWith(true);
      expect(screen.getByText('Cloud speech consent active')).toBeDefined();

      // Now reading aloud invokes cloud synthesizer
      await clickButton(screen.getByRole('button', { name: /Read answer aloud/i }));
      expect(cloudSpeakMock).toHaveBeenCalledWith('Photosynthesis makes sugar.', { lang: 'en' });

      // Revoking consent resets state and blocks further synthesis
      await clickButton(screen.getByRole('button', { name: 'Revoke cloud speech consent' }));
      expect(onConsentChange).toHaveBeenCalledWith(false);
      expect(
        screen.getByText(
          /Cloud speech synthesis sends the answer text to an external speech provider/i,
        ),
      ).toBeDefined();
    });

    it('speaks exactly the answer text with language tag and does not add uncited claims or private tokens', async () => {
      const { client, respond } = controllableClient();
      const { synthesizer, speakMock } = controllableSpeechSynthesizer();
      render(<Assistant client={client} speechSynthesizer={synthesizer} />);

      const privateQuestion = 'My secret account token is TOKEN-XYZ-999. Tell me about biology.';
      type(privateQuestion);
      fireEvent.keyDown(questionBox(), { key: 'Enter' });
      await respond(citedEnglishAnswer);

      await clickButton(screen.getByRole('button', { name: /Read answer aloud/i }));

      // Audio output contains ONLY reply.text and reply.lang
      expect(speakMock).toHaveBeenCalledTimes(1);
      const [spokenText, spokenOptions] = speakMock.mock.calls[0] as [string, { lang: string }];
      expect(spokenText).toBe('Photosynthesis makes sugar.');
      expect(spokenOptions.lang).toBe('en');

      // Does NOT speak learner's private question or token
      expect(spokenText).not.toContain('TOKEN-XYZ-999');
      expect(spokenText).not.toContain('secret');

      // Complete text and citations remain fully accessible in the document
      expect(screen.getAllByText('Photosynthesis makes sugar.').length).toBeGreaterThan(0);
      expect(screen.getByText(/Biology Basics — Photosynthesis Section/)).toBeDefined();
    });

    it('handles speech provider failure gracefully leaving complete text and citations intact', async () => {
      const { client, respond } = controllableClient();
      const { synthesizer } = controllableSpeechSynthesizer({ fail: true });
      render(<Assistant client={client} speechSynthesizer={synthesizer} />);

      type('Question');
      fireEvent.keyDown(questionBox(), { key: 'Enter' });
      await respond(citedEnglishAnswer);

      await clickButton(screen.getByRole('button', { name: /Read answer aloud/i }));

      // Alert notifies learner of failure
      expect(screen.getByRole('alert').textContent).toContain(
        'Spoken audio could not be generated. The complete written answer and citations remain available below.',
      );

      // Both the complete text and citations remain visible and untouched
      expect(screen.getAllByText('Photosynthesis makes sugar.').length).toBeGreaterThan(0);
      expect(screen.getByText(/Biology Basics — Photosynthesis Section/)).toBeDefined();
    });

    it('handles missing language support gracefully leaving complete text and citations intact', async () => {
      const { client, respond } = controllableClient();
      const { synthesizer } = controllableSpeechSynthesizer({
        isSupported: (lang) => lang !== 'am',
      });
      render(<Assistant client={client} speechSynthesizer={synthesizer} />);

      type('ጥያቄ');
      fireEvent.keyDown(questionBox(), { key: 'Enter' });
      await respond({
        kind: 'answer',
        reply: {
          id: 'r-am',
          text: 'ፎቶሲንተሲስ ስኳር ያመርታል።',
          lang: 'am',
          createdAt: '2026-09-11T12:00:00.000Z',
          citations: [
            {
              sourceId: 'src-am',
              sectionId: 'sec-am',
              sourceTitle: 'ስነ-ህይወት',
              heading: 'ፎቶሲንተሲስ',
            },
          ],
        },
      });

      await clickButton(screen.getByRole('button', { name: /Read answer aloud/i }));

      // Alert notifies learner that language is unsupported by this speech provider
      expect(screen.getByRole('alert').textContent).toContain(
        'Spoken audio is not available for this language on the selected speech provider.',
      );

      // Written Amharic text and citations remain visible
      expect(screen.getAllByText('ፎቶሲንተሲስ ስኳር ያመርታል።').length).toBeGreaterThan(0);
      expect(screen.getByText(/ስነ-ህይወት — ፎቶሲንተሲስ/)).toBeDefined();
    });

    it('cleans up temporary audio resources (object URLs) when cloud playback stops or ends', async () => {
      const mockCreateObjectUrl = vi.fn(() => 'blob:mock-audio-url-123');
      const mockRevokeObjectUrl = vi.fn();
      globalThis.URL.createObjectURL = mockCreateObjectUrl;
      globalThis.URL.revokeObjectURL = mockRevokeObjectUrl;

      let triggerEnded: (() => void) | undefined;
      const pauseMock = vi.fn();
      const playMock = vi.fn(() => Promise.resolve());

      class MockAudio {
        src = '';
        onplay: (() => void) | null = null;
        onended: (() => void) | null = null;
        onerror: (() => void) | null = null;
        constructor(url: string) {
          this.src = url;
          // eslint-disable-next-line @typescript-eslint/no-this-alias
          const self = this;
          triggerEnded = () => {
            self.onended?.();
          };
        }
        play = playMock;
        pause = pauseMock;
        load = vi.fn();
        removeAttribute = vi.fn();
      }

      globalThis.Audio = MockAudio as unknown as typeof Audio;

      const cloudSynth = new CloudSpeechSynthesizer(
        () => true,
        () => Promise.resolve(new Blob(['fake-audio-bytes'], { type: 'audio/mp3' })),
      );

      // 1. Speak and then stop explicitly: verifies revokeObjectURL is called
      const playback = await cloudSynth.speak('Hello learner', { lang: 'en' });
      expect(mockCreateObjectUrl).toHaveBeenCalled();

      playback.stop();
      expect(pauseMock).toHaveBeenCalled();
      expect(mockRevokeObjectUrl).toHaveBeenCalledWith('blob:mock-audio-url-123');

      // 2. Speak and finish naturally via onended
      mockRevokeObjectUrl.mockClear();
      await cloudSynth.speak('Second sample', { lang: 'en' });
      triggerEnded?.();
      expect(mockRevokeObjectUrl).toHaveBeenCalledWith('blob:mock-audio-url-123');
    });

    it('BrowserSpeechSynthesizer requires verified Amharic voice before reporting Amharic support', () => {
      // Per T3-011: "Sample output is checked for intelligibility with an appropriate speaker;
      // unsupported quality is not presented as verified Amharic support."
      const mockSynthWithoutAmharic = {
        getVoices: () => [{ lang: 'en-US', name: 'English Voice' } as SpeechSynthesisVoice],
        cancel: vi.fn(),
        speak: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
      } as unknown as SpeechSynthesis;

      const synth1 = new BrowserSpeechSynthesizer(() => mockSynthWithoutAmharic);
      expect(synth1.isSupported('en')).toBe(true);
      expect(synth1.isSupported('am')).toBe(false);

      const mockSynthWithAmharic = {
        getVoices: () => [
          { lang: 'en-US', name: 'English Voice' } as SpeechSynthesisVoice,
          { lang: 'am-ET', name: 'Amharic Voice' } as SpeechSynthesisVoice,
        ],
        cancel: vi.fn(),
        speak: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
      } as unknown as SpeechSynthesis;

      const synth2 = new BrowserSpeechSynthesizer(() => mockSynthWithAmharic);
      expect(synth2.isSupported('am')).toBe(true);
    });
  });

  describe('Job answers and citations (T3-019-B)', () => {
    it('renders job answers with Assistant (approved jobs) speaker and clickable citation links', async () => {
      const { client, respond } = controllableClient();
      render(<Assistant client={client} mode="faq" />);
      type('Are there any virtual assistant jobs?');
      fireEvent.keyDown(questionBox(), { key: 'Enter' });

      await respond({
        kind: 'answer',
        reply: {
          id: 'job-ans-1',
          text: 'Savanna Digital Services has an active opening for a Virtual Assistant Specialist in Addis Ababa. Requirements: managing executive calendars, client correspondence, and digital document filing.',
          lang: 'en',
          createdAt: '2026-09-11T12:00:00.000Z',
          provider: 'job',
          citations: [
            {
              sourceId: 'job-va-specialist-01',
              sectionId: 'requirements',
              sourceTitle: 'Savanna Digital Services — Virtual Assistant Specialist',
              heading: 'Addis Ababa (Active)',
              url: 'https://digitalbridge.et/jobs/job-va-specialist-01',
            },
          ],
        },
      });

      const messages = screen.getAllByRole('listitem');
      expect(messages[0]?.textContent).toBe('YouAre there any virtual assistant jobs?');
      expect(screen.getByText('Assistant (approved jobs)')).toBeTruthy();

      const link = screen.getByRole('link', {
        name: 'Savanna Digital Services — Virtual Assistant Specialist — Addis Ababa (Active)',
      });
      expect(link).toHaveProperty('href', 'https://digitalbridge.et/jobs/job-va-specialist-01');
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    });

    it('renders expired job acknowledgement with honest limitation and citation', async () => {
      const { client, respond } = controllableClient();
      render(<Assistant client={client} mode="faq" />);
      type('Is the Data Entry Clerk job open?');
      fireEvent.keyDown(questionBox(), { key: 'Enter' });

      await respond({
        kind: 'answer',
        reply: {
          id: 'job-ans-2',
          text: 'The Data Entry and Records Clerk position at Ethio Tech Solutions (Addis Ababa) expired on 2026-10-01 and is no longer open for applications.',
          lang: 'en',
          createdAt: '2026-09-11T12:00:00.000Z',
          provider: 'job',
          citations: [
            {
              sourceId: 'job-data-clerk-02',
              sectionId: 'status',
              sourceTitle: 'Ethio Tech Solutions — Data Entry and Records Clerk',
              heading: 'Addis Ababa (Expired)',
              url: 'https://digitalbridge.et/jobs/job-data-clerk-02',
            },
          ],
        },
      });

      expect(
        screen.getAllByText(
          /The Data Entry and Records Clerk position at Ethio Tech Solutions \(Addis Ababa\) expired on 2026-10-01 and is no longer open for applications\./,
        ).length,
      ).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Assistant (approved jobs)')).toBeTruthy();
    });

    it('renders honest limitation for unknown jobs without fabricated citations', async () => {
      const { client, respond } = controllableClient();
      render(<Assistant client={client} mode="faq" />);
      type('Is Google hiring a software engineer in Addis Ababa?');
      fireEvent.keyDown(questionBox(), { key: 'Enter' });

      await respond({
        kind: 'answer',
        reply: {
          id: 'job-ans-3',
          text: 'I do not have an approved job record for that position or organization. External web search is not used.',
          lang: 'en',
          createdAt: '2026-09-11T12:00:00.000Z',
          provider: 'job',
        },
      });

      expect(
        screen.getAllByText(
          'I do not have an approved job record for that position or organization. External web search is not used.',
        ).length,
      ).toBeGreaterThanOrEqual(1);
      expect(screen.queryByRole('link')).toBeNull();
    });
  });

  describe('Learner-selected simple-language mode (T3-029)', () => {
    it('is disabled by default and starts unchecked', () => {
      const { client } = controllableClient();
      render(<Assistant client={client} />);
      const checkbox = screen.getByLabelText<HTMLInputElement>('Use simple, direct language');
      expect(checkbox.checked).toBe(false);
      expect(screen.queryByText(/Operating in simple-language mode/)).toBeNull();
    });

    it('toggles simple-language mode and invokes onSimpleLanguageChange callback', () => {
      const { client } = controllableClient();
      const onChange = vi.fn();
      render(<Assistant client={client} onSimpleLanguageChange={onChange} />);

      const checkbox = screen.getByLabelText<HTMLInputElement>('Use simple, direct language');
      fireEvent.click(checkbox);
      expect(checkbox.checked).toBe(true);
      expect(onChange).toHaveBeenCalledWith(true);
      expect(screen.getByText(/Operating in simple-language mode/)).toBeDefined();

      fireEvent.click(checkbox);
      expect(checkbox.checked).toBe(false);
      expect(onChange).toHaveBeenCalledWith(false);
      expect(screen.queryByText(/Operating in simple-language mode/)).toBeNull();
    });

    it('passes simpleLanguage option to client.ask when enabled', async () => {
      const { client, ask, respond } = controllableClient();
      render(<Assistant client={client} defaultSimpleLanguage={true} />);

      const checkbox = screen.getByLabelText<HTMLInputElement>('Use simple, direct language');
      expect(checkbox.checked).toBe(true);

      type('What is photosynthesis?');
      fireEvent.keyDown(questionBox(), { key: 'Enter' });
      expect(ask).toHaveBeenCalledWith('What is photosynthesis?', { simpleLanguage: true });

      await respond(citedEnglishAnswer);
      expect(screen.getAllByText('Photosynthesis makes sugar.').length).toBeGreaterThan(0);
      expect(screen.getByText(/Biology Basics — Photosynthesis Section/)).toBeDefined();
    });

    it('preserves question draft and conversation history when toggling mode', async () => {
      const { client, respond } = controllableClient();
      render(<Assistant client={client} />);

      type('First question');
      fireEvent.keyDown(questionBox(), { key: 'Enter' });
      await respond(englishAnswer);

      type('Unsent draft');

      const checkbox = screen.getByLabelText<HTMLInputElement>('Use simple, direct language');
      fireEvent.click(checkbox);

      // Previous answer still in document
      expect(screen.getAllByText('Photosynthesis makes sugar.').length).toBeGreaterThan(0);
      // Unsent question draft preserved
      expect((questionBox() as HTMLTextAreaElement).value).toBe('Unsent draft');
    });

    it('renders Amharic toggle label and notice in Amharic locale', () => {
      const { client } = controllableClient();
      render(
        <LocaleContext value="am">
          <Assistant client={client} defaultSimpleLanguage={true} />
        </LocaleContext>,
      );

      const checkbox = screen.getByLabelText<HTMLInputElement>('ቀላል እና ግልጽ ቋንቋ ተጠቀም');
      expect(checkbox.checked).toBe(true);
      expect(screen.getByText(/በቀላል ቋንቋ ሁነታ ላይ ይሰራል/)).toBeDefined();
    });
  });

  describe('Career web research mode (T3-028-B)', () => {
    it('starts with research mode disabled by default and presents standard mode notice', () => {
      const { client } = controllableClient();
      render(<Assistant client={client} mode="faq" />);

      const toggle = screen.getByLabelText<HTMLInputElement>(
        /Enable supplementary career web research/i,
      );
      expect(toggle.checked).toBe(false);
      expect(
        screen.getByText(
          /Operating in approved course FAQ mode. Answers are grounded in course materials with explicit citations without cloud processing./i,
        ),
      ).toBeTruthy();
    });

    it('course mode never searches implicitly and routes to client.ask when research mode is off', async () => {
      const { client, ask: clientAsk, respond: clientRespond } = controllableClient();
      const { client: researchClient, ask: researchAsk } = controllableClient();

      render(<Assistant client={client} researchClient={researchClient} mode="faq" />);
      type('What is an operating system?');
      fireEvent.keyDown(questionBox(), { key: 'Enter' });

      expect(clientAsk).toHaveBeenCalledWith('What is an operating system?');
      expect(researchAsk).not.toHaveBeenCalled();

      await clientRespond({
        kind: 'answer',
        reply: {
          id: 'course-ans-1',
          text: 'An operating system manages hardware and software resources.',
          lang: 'en',
          createdAt: '2026-09-11T12:00:00.000Z',
          provider: 'faq',
        },
      });

      expect(screen.getByText('Assistant (course FAQ)')).toBeTruthy();
    });

    it('labels an offline verbatim lesson excerpt as a quote, not a written answer (T3-054)', async () => {
      const { client, respond } = controllableClient();
      render(<Assistant client={client} mode="faq" />);
      type('What is the future of the VA industry?');
      fireEvent.keyDown(questionBox(), { key: 'Enter' });

      await respond({
        kind: 'answer',
        reply: {
          id: 'quote-1',
          text: 'Yes, but not in a passive way.',
          lang: 'en',
          createdAt: '2026-09-11T12:00:00.000Z',
          provider: 'faq',
          provenance: { kind: 'course' },
        },
      });

      expect(screen.getByText('Assistant (quoted from your course)')).toBeTruthy();
      expect(screen.queryByText('Assistant (course FAQ)')).toBeNull();
      expect(
        screen.getByText(/quoted word for word. It is not a written answer/).getAttribute('role'),
      ).toBe('note');
    });

    it('toggling research mode ON immediately updates notice and routes questions to researchClient with external provenance', async () => {
      const { client, ask: clientAsk } = controllableClient();
      const {
        client: researchClient,
        ask: researchAsk,
        respond: researchRespond,
      } = controllableClient();

      render(<Assistant client={client} researchClient={researchClient} mode="faq" />);

      const toggle = screen.getByLabelText<HTMLInputElement>(
        /Enable supplementary career web research/i,
      );
      fireEvent.click(toggle);
      expect(toggle.checked).toBe(true);

      // Immediately updates notice
      expect(
        screen.getByText(
          /Operating in career web research mode. Queries are minimised and sent to external search providers with your explicit consent./i,
        ),
      ).toBeTruthy();

      type('What are current entry-level VA compensation rates in Addis Ababa?');
      fireEvent.keyDown(questionBox(), { key: 'Enter' });

      // Routed to researchClient, not course client
      expect(researchAsk).toHaveBeenCalledWith(
        'What are current entry-level VA compensation rates in Addis Ababa?',
      );
      expect(clientAsk).not.toHaveBeenCalled();

      await researchRespond({
        kind: 'answer',
        reply: {
          id: 'research-ans-1',
          text: 'Current market rates in Addis Ababa range from 15,000 to 25,000 ETB for entry-level remote Virtual Assistants.',
          lang: 'en',
          createdAt: '2026-09-11T12:00:00.000Z',
          provider: 'external_web_research',
          citations: [
            {
              sourceId: 'web-1',
              sectionId: 'salary-report',
              sourceTitle: 'Addis Ababa Remote Work Trends 2026',
              heading: 'Compensation Survey',
              url: 'https://digitalbridge.et/research/va-2026',
            },
          ],
        },
      });

      // Distinct speaker label
      expect(screen.getByText('Assistant (external web research)')).toBeTruthy();

      // Distinct provenance disclaimer
      expect(
        screen.getByText(
          /Source: External web research. Information from external web sources is unverified and not part of the approved course curriculum./i,
        ),
      ).toBeTruthy();

      // Accessible citation link
      const citationLink = screen.getByRole('link', {
        name: 'Addis Ababa Remote Work Trends 2026 — Compensation Survey',
      });
      expect(citationLink.getAttribute('href')).toBe('https://digitalbridge.et/research/va-2026');
      expect(citationLink.getAttribute('target')).toBe('_blank');
      expect(citationLink.getAttribute('rel')).toBe('noopener noreferrer');
    });

    it('leaving research mode immediately restores standard approved-source tutoring behavior while preserving history', async () => {
      const { client, ask: clientAsk, respond: clientRespond } = controllableClient();
      const {
        client: researchClient,
        ask: researchAsk,
        respond: researchRespond,
      } = controllableClient();

      render(<Assistant client={client} researchClient={researchClient} mode="faq" />);

      // Enable research mode
      const toggle = screen.getByLabelText<HTMLInputElement>(
        /Enable supplementary career web research/i,
      );
      fireEvent.click(toggle);

      type('Research VA jobs');
      fireEvent.keyDown(questionBox(), { key: 'Enter' });
      await researchRespond({
        kind: 'answer',
        reply: {
          id: 'res-1',
          text: 'Found 12 external postings.',
          lang: 'en',
          createdAt: '2026-09-11T12:00:00.000Z',
          provider: 'external_web_research',
        },
      });

      expect(screen.getByText('Assistant (external web research)')).toBeTruthy();

      // Turn OFF research mode
      fireEvent.click(toggle);
      expect(toggle.checked).toBe(false);

      // Notice restored to approved course mode
      expect(
        screen.getByText(
          /Operating in approved course FAQ mode. Answers are grounded in course materials with explicit citations without cloud processing./i,
        ),
      ).toBeTruthy();

      // Subsequent question routes strictly to course client
      type('What is module 2 about?');
      fireEvent.keyDown(questionBox(), { key: 'Enter' });

      expect(clientAsk).toHaveBeenCalledWith('What is module 2 about?');
      expect(researchAsk).toHaveBeenCalledTimes(1); // Only the first research question

      await clientRespond({
        kind: 'answer',
        reply: {
          id: 'course-ans-2',
          text: 'Module 2 covers calendar management.',
          lang: 'en',
          createdAt: '2026-09-11T12:00:00.000Z',
          provider: 'faq',
        },
      });

      // Previous external research entry retains its distinct provenance label
      expect(screen.getByText('Assistant (external web research)')).toBeTruthy();
      expect(screen.getByText('Assistant (course FAQ)')).toBeTruthy();
    });

    it('preserves question draft in textarea when toggling research mode on and off', () => {
      const { client } = controllableClient();
      render(<Assistant client={client} mode="faq" />);

      const toggle = screen.getByLabelText(/Enable supplementary career web research/i);
      type('My draft question about market data');
      expect((questionBox() as HTMLTextAreaElement).value).toBe(
        'My draft question about market data',
      );

      fireEvent.click(toggle);
      expect((questionBox() as HTMLTextAreaElement).value).toBe(
        'My draft question about market data',
      );

      fireEvent.click(toggle);
      expect((questionBox() as HTMLTextAreaElement).value).toBe(
        'My draft question about market data',
      );
    });

    it('renders bilingual Amharic labels and announcements when locale is am', async () => {
      const { client, respond } = controllableClient();
      render(
        <LocaleContext value="am">
          <Assistant client={client} mode="faq" />
        </LocaleContext>,
      );

      // Amharic toggle label
      const toggle = screen.getByLabelText<HTMLInputElement>(/ተጨማሪ የሙያ ድር ጥናትን አንቃ/i);
      expect(toggle).toBeTruthy();
      expect(toggle.checked).toBe(false);

      fireEvent.click(toggle);
      expect(toggle.checked).toBe(true);

      // Amharic mode notice
      expect(screen.getByText(/በሙያ ድር ጥናት ሁነታ ላይ ይሰራል። ጥያቄዎች ተቀንሰው/i)).toBeTruthy();

      const textarea = screen.getByLabelText('ጥያቄዎ');
      fireEvent.change(textarea, { target: { value: 'የስራ እድሎች ምንድን ናቸው?' } });
      fireEvent.keyDown(textarea, { key: 'Enter' });

      await respond({
        kind: 'answer',
        reply: {
          id: 'res-am-1',
          text: 'በአዲስ አበባ ውስጥ በርካታ የቨርቹዋል ረዳት ክፍት የስራ መደቦች አሉ።',
          lang: 'am',
          createdAt: '2026-09-11T12:00:00.000Z',
          provider: 'external_web_research',
        },
      });

      // Amharic speaker label
      expect(screen.getByText('ረዳት (የውጭ ድር ጥናት)')).toBeTruthy();
      // Amharic provenance disclaimer
      expect(screen.getByText(/ምንጭ፦ የውጭ ድር ጥናት። ከውጭ ድር ምንጮች የተገኘ መረጃ/i)).toBeTruthy();
    });
  });

  describe('Pluggable AI layer and local model mode (T3-037)', () => {
    it('renders local mode notice and labels assistant as local AI in mode="local"', async () => {
      const { client, respond } = controllableClient();
      render(<Assistant client={client} mode="local" />);

      // Local mode notice with zero external data transmission
      const note = screen.getByRole('note').textContent;
      expect(note).toContain('Operating in local open model mode');
      expect(note).toContain('zero external data transmission');

      // External consent checkbox is omitted in local mode
      expect(
        screen.queryByLabelText('Allow external AI processing for course questions'),
      ).toBeNull();

      type('What tasks can AI assist with?');
      fireEvent.keyDown(questionBox(), { key: 'Enter' });
      await respond({
        kind: 'answer',
        reply: {
          id: 'r-local-1',
          text: 'AI assists with routine tasks [artificial-intelligence-and-the-future-of-va-work].',
          lang: 'en',
          createdAt: '2026-09-11T12:00:00.000Z',
          provider: 'local',
        },
      });

      const messages = screen.getAllByRole('listitem').map((item) => item.textContent);
      expect(messages[1]).toContain('Assistant (local AI)');
    });

    it('renders bilingual Amharic notice and speaker label in local mode', async () => {
      const { client, respond } = controllableClient();
      render(
        <LocaleContext value="am">
          <Assistant client={client} mode="local" />
        </LocaleContext>,
      );

      // Amharic local mode notice
      const note = screen.getByRole('note').textContent;
      expect(note).toContain('በአካባቢያዊ ክፍት ሞዴል ሁነታ ላይ ይገኛል።');
      expect(note).toContain('ያለ ምንም ውጫዊ የውሂብ ማስተላለፍ');

      // External consent checkbox is omitted in local mode
      expect(screen.queryByLabelText('ለትምህርት ጥያቄዎች ውጫዊ AI ማቀነባበሪያ ይፈቀድ')).toBeNull();

      const textarea = screen.getByLabelText('ጥያቄዎ');
      fireEvent.change(textarea, { target: { value: 'የAI ተግባራት ምንድን ናቸው?' } });
      fireEvent.keyDown(textarea, { key: 'Enter' });

      await respond({
        kind: 'answer',
        reply: {
          id: 'r-local-am-1',
          text: 'AI መደበኛ ስራዎችን ያግዛል [breaks]።',
          lang: 'am',
          createdAt: '2026-09-11T12:00:00.000Z',
          provider: 'local',
        },
      });

      const messages = screen.getAllByRole('listitem').map((item) => item.textContent);
      expect(messages[1]).toContain('ረዳት (የአካባቢ AI)');
    });
  });
});
