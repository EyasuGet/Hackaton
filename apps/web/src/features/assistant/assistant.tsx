// Accessible conversation shell: a labelled question box, a message history,
// source citations, readable pending/error states, and optional accessible speech playback (T3-011).
// All text is rendered as React text, never HTML.
import {
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import {
  LocaleContext,
  lookup,
  T,
  useT,
  type Locale,
  type MessageKey,
} from '../../shared/i18n/i18n.tsx';
import { formatAddisDate, type DateLanguage } from '../../shared/i18n/addis-date.ts';
import type { AskResult, Citation, ConversationClient } from './conversation.ts';
import { AudioRecorderError, BrowserAudioRecorder, type AudioRecorder } from './audio-recorder.ts';
import {
  BrowserSpeechSynthesizer,
  CloudSpeechSynthesizer,
  type SpeechPlayback,
  type SpeechState,
  type SpeechSynthesizer,
} from './speech-adapter.ts';

interface Entry {
  readonly id: string;
  readonly speaker: 'learner' | 'assistant';
  readonly text: string;
  readonly lang?: string;
  readonly createdAt?: string;
  readonly citations?: readonly Citation[];
  readonly provider?: 'online' | 'faq' | 'job' | 'external_web_research' | 'local';
  readonly provenance?: {
    readonly kind: string;
    readonly disclaimer?: string;
  };
  readonly simpleLanguage?: boolean;
}

type Problem = 'empty' | 'denied' | 'failed';

const PROBLEM_TEXT: Record<Problem, MessageKey> = {
  empty: 'assistant.problemEmpty',
  denied: 'assistant.problemDenied',
  failed: 'assistant.problemFailed',
};

type SpeechProblemKind = 'failed' | 'unsupported' | 'consentRequired';

const SPEECH_PROBLEM_TEXT: Record<SpeechProblemKind, MessageKey> = {
  failed: 'assistant.speechErrorFailed',
  unsupported: 'assistant.speechErrorUnsupported',
  consentRequired: 'assistant.speechErrorConsentRequired',
};

type VoiceState = 'idle' | 'recording' | 'transcribing' | 'review';
type VoiceProblemKind = 'micDenied' | 'unsupported' | 'failed' | 'tooLarge' | 'unavailable';

const VOICE_PROBLEM_TEXT: Record<VoiceProblemKind, MessageKey> = {
  micDenied: 'assistant.voiceMicDenied',
  unsupported: 'assistant.voiceUnsupported',
  failed: 'assistant.voiceError',
  tooLarge: 'assistant.voiceTooLarge',
  unavailable: 'assistant.voiceUnavailable',
};

// Answer providers only write English and Amharic; other interface locales get a note.
function isAnswerLanguage(locale: Locale): boolean {
  return locale === 'en' || locale === 'am';
}

function dateLanguage(lang: string | undefined): DateLanguage {
  return lang?.toLowerCase().startsWith('am') ? 'am' : 'en';
}

function MessageDate({
  instant,
  language,
}: {
  readonly instant: string;
  readonly language: DateLanguage;
}) {
  const date = formatAddisDate(instant, language);
  // A malformed or unsupported timestamp must not hide the reply itself.
  if (!date) return null;

  return (
    <p className="message-date">
      <time dateTime={instant}>
        <span lang={language}>{date.ethiopian}</span> (<T k="date.ethiopianCalendar" />)
        <span aria-hidden="true"> · </span>
        <span lang={language}>{date.gregorian}</span> (<T k="date.gregorianCalendar" />)
        <span aria-hidden="true"> · </span>
        <span>{date.addisAbabaTime}</span> <T k="date.addisAbabaTime" />
      </time>
    </p>
  );
}

export interface AssistantProps {
  readonly client: ConversationClient;
  readonly researchClient?: ConversationClient;
  readonly mode?: 'demo' | 'faq' | 'online' | 'local';
  readonly speechSynthesizer?: SpeechSynthesizer;
  readonly cloudSynthesizer?: SpeechSynthesizer;
  readonly defaultSpeechEngine?: 'client' | 'cloud';
  readonly defaultCloudConsent?: boolean;
  readonly onCloudConsentChange?: (consented: boolean) => void;
  readonly consent?: boolean;
  readonly onConsentChange?: (consented: boolean) => void;
  readonly simpleLanguage?: boolean;
  readonly onSimpleLanguageChange?: (enabled: boolean) => void;
  readonly defaultSimpleLanguage?: boolean;
  readonly audioRecorder?: AudioRecorder;
  readonly researchMode?: boolean;
  readonly onResearchModeChange?: (enabled: boolean) => void;
}

export function Assistant({
  client,
  researchClient,
  mode = 'demo',
  speechSynthesizer,
  cloudSynthesizer,
  defaultSpeechEngine = 'client',
  defaultCloudConsent = false,
  onCloudConsentChange,
  consent,
  onConsentChange,
  simpleLanguage,
  onSimpleLanguageChange,
  defaultSimpleLanguage = false,
  audioRecorder,
  researchMode,
  onResearchModeChange,
}: AssistantProps) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [internalSimpleLanguage, setInternalSimpleLanguage] = useState(defaultSimpleLanguage);
  const isSimpleLanguage = simpleLanguage ?? internalSimpleLanguage;
  const handleSimpleLanguageChange = (checked: boolean) => {
    setInternalSimpleLanguage(checked);
    onSimpleLanguageChange?.(checked);
  };

  // Voice recording & review state (T3-010-B)
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [voiceProblem, setVoiceProblem] = useState<VoiceProblemKind | null>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);
  if (!recorderRef.current) {
    recorderRef.current = audioRecorder ?? new BrowserAudioRecorder();
  }
  const recorder = audioRecorder ?? recorderRef.current;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Career web research mode state (T3-028-B, disabled by default)
  const [internalResearchMode, setInternalResearchMode] = useState(false);
  const isResearchMode = researchMode ?? internalResearchMode;
  const setResearchMode = (enabled: boolean) => {
    setInternalResearchMode(enabled);
    onResearchModeChange?.(enabled);
  };

  // Speech playback and consented cloud synthesis state (T3-011)
  const [speechEngine, setSpeechEngine] = useState<'client' | 'cloud'>(defaultSpeechEngine);
  const [cloudConsent, setCloudConsent] = useState(defaultCloudConsent);
  const [playbackState, setPlaybackState] = useState<SpeechState>('idle');
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const [speechProblem, setSpeechProblem] = useState<{
    messageId: string;
    kind: SpeechProblemKind;
  } | null>(null);
  const activePlaybackRef = useRef<SpeechPlayback | null>(null);

  // Captured as text when announced: a later language switch must not rewrite the
  // live region, or screen readers would read the reply again.
  const [announcement, setAnnouncement] = useState<{
    prefix?: { text: string; lang: string };
    text: string;
    lang?: string;
  }>({ text: '' });
  // State updates are asynchronous, so a ref blocks a second send in the same tick.
  const inFlight = useRef(false);
  const ids = {
    question: useId(),
    hint: useId(),
    problem: useId(),
    heading: useId(),
    consent: useId(),
    consentHint: useId(),
    simpleLanguage: useId(),
    simpleLanguageHint: useId(),
    speechEngine: useId(),
    voiceRegion: useId(),
    voiceProblem: useId(),
    researchMode: useId(),
    researchModeHint: useId(),
  };
  const t = useT();
  const locale = useContext(LocaleContext);
  // A reply can arrive after a language switch; announce it in the language shown then.
  const localeRef = useRef(locale);
  useEffect(() => {
    localeRef.current = locale;
  }, [locale]);

  const stopPlayback = () => {
    if (activePlaybackRef.current) {
      activePlaybackRef.current.stop();
      activePlaybackRef.current = null;
    }
    setPlaybackState('idle');
    setPlayingMessageId(null);
  };

  // Stops speech playback and cancels audio recording on navigation
  useEffect(() => {
    const onNavigation = () => {
      stopPlayback();
      recorder.cancel();
    };
    window.addEventListener('popstate', onNavigation);
    window.addEventListener('beforeunload', onNavigation);
    window.addEventListener('pagehide', onNavigation);

    return () => {
      stopPlayback();
      recorder.cancel();
      window.removeEventListener('popstate', onNavigation);
      window.removeEventListener('beforeunload', onNavigation);
      window.removeEventListener('pagehide', onNavigation);
    };
  }, [recorder]);

  async function startVoiceRecording() {
    stopPlayback();
    setVoiceProblem(null);
    try {
      await recorder.start();
      setVoiceState('recording');
      setAnnouncement(lookup(localeRef.current, 'assistant.voiceRecording'));
    } catch (err: unknown) {
      if (err instanceof AudioRecorderError) {
        if (err.kind === 'permission_denied') {
          setVoiceProblem('micDenied');
        } else if (err.kind === 'unsupported') {
          setVoiceProblem('unsupported');
        } else {
          setVoiceProblem('failed');
        }
      } else {
        setVoiceProblem('failed');
      }
      setVoiceState('idle');
    }
  }

  async function stopVoiceRecording() {
    setVoiceState('transcribing');
    setVoiceProblem(null);
    let audioResult;
    try {
      audioResult = await recorder.stop();
    } catch {
      setVoiceProblem('failed');
      setVoiceState('idle');
      return;
    }

    if (!client.transcribe) {
      setVoiceProblem('unavailable');
      setVoiceState('idle');
      return;
    }

    try {
      const outcome = await client.transcribe(audioResult.audioBase64, audioResult.mimeType);
      if (outcome.kind === 'transcribed') {
        const text = outcome.transcript.trim();
        setDraft((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
        setVoiceState('review');
        setVoiceProblem(null);
        if (problem === 'empty') setProblem(null);
        setAnnouncement(lookup(localeRef.current, 'assistant.voiceReviewHint'));
        textareaRef.current?.focus();
      } else if (outcome.kind === 'too_large') {
        setVoiceProblem('tooLarge');
        setVoiceState('idle');
      } else if (outcome.kind === 'unsupported_format') {
        setVoiceProblem('unsupported');
        setVoiceState('idle');
      } else if (outcome.kind === 'unavailable') {
        setVoiceProblem('unavailable');
        setVoiceState('idle');
      } else if (outcome.kind === 'denied') {
        setProblem('denied');
        setVoiceState('idle');
      } else {
        setVoiceProblem('failed');
        setVoiceState('idle');
      }
    } catch {
      setVoiceProblem('failed');
      setVoiceState('idle');
    }
  }

  function discardVoice() {
    recorder.cancel();
    if (voiceState === 'review') {
      setDraft('');
    }
    setVoiceState('idle');
    setVoiceProblem(null);
  }

  async function startSpeaking(entry: Entry) {
    stopPlayback();
    setSpeechProblem(null);

    const lang = entry.lang || 'en';

    if (speechEngine === 'cloud') {
      if (!cloudConsent) {
        setSpeechProblem({ messageId: entry.id, kind: 'consentRequired' });
        return;
      }
      const synth = cloudSynthesizer ?? new CloudSpeechSynthesizer(() => cloudConsent);
      const isSupp = await synth.isSupported(lang);
      if (!isSupp) {
        setSpeechProblem({ messageId: entry.id, kind: 'unsupported' });
        return;
      }

      setPlayingMessageId(entry.id);
      setPlaybackState('playing');

      const playback = await synth.speak(
        entry.text,
        { lang },
        {
          onStart: () => {
            setPlaybackState('playing');
            setPlayingMessageId(entry.id);
          },
          onPause: () => {
            setPlaybackState('paused');
          },
          onResume: () => {
            setPlaybackState('playing');
          },
          onEnd: () => {
            setPlaybackState('idle');
            setPlayingMessageId(null);
            activePlaybackRef.current = null;
          },
          onError: (err) => {
            setPlaybackState('idle');
            setPlayingMessageId(null);
            activePlaybackRef.current = null;
            const kind = err.message.includes('ConsentRequired')
              ? 'consentRequired'
              : err.message.includes('not supported')
                ? 'unsupported'
                : 'failed';
            setSpeechProblem({ messageId: entry.id, kind });
          },
        },
      );
      activePlaybackRef.current = playback;
    } else {
      const synth = speechSynthesizer ?? new BrowserSpeechSynthesizer();
      const isSupp = await synth.isSupported(lang);
      if (!isSupp) {
        setSpeechProblem({ messageId: entry.id, kind: 'unsupported' });
        return;
      }

      setPlayingMessageId(entry.id);
      setPlaybackState('playing');

      const playback = await synth.speak(
        entry.text,
        { lang },
        {
          onStart: () => {
            setPlaybackState('playing');
            setPlayingMessageId(entry.id);
          },
          onPause: () => {
            setPlaybackState('paused');
          },
          onResume: () => {
            setPlaybackState('playing');
          },
          onEnd: () => {
            setPlaybackState('idle');
            setPlayingMessageId(null);
            activePlaybackRef.current = null;
          },
          onError: (err) => {
            setPlaybackState('idle');
            setPlayingMessageId(null);
            activePlaybackRef.current = null;
            const kind = err.message.includes('not supported') ? 'unsupported' : 'failed';
            setSpeechProblem({ messageId: entry.id, kind });
          },
        },
      );
      activePlaybackRef.current = playback;
    }
  }

  function pauseSpeaking() {
    activePlaybackRef.current?.pause();
    setPlaybackState('paused');
  }

  function resumeSpeaking() {
    activePlaybackRef.current?.resume();
    setPlaybackState('playing');
  }

  function stopSpeaking() {
    stopPlayback();
  }

  async function send() {
    if (inFlight.current) return;
    const question = draft.trim();
    if (!question) {
      setProblem('empty');
      return;
    }
    inFlight.current = true;
    setSending(true);
    setProblem(null);
    if (voiceState === 'review') {
      setVoiceState('idle');
    }
    setAnnouncement(lookup(locale, 'assistant.sending'));

    let result: AskResult;
    try {
      const activeClient = isResearchMode && researchClient ? researchClient : client;
      result = isSimpleLanguage
        ? await activeClient.ask(question, { simpleLanguage: true })
        : await activeClient.ask(question);
    } catch {
      // The contract says ask() must not reject; if one does, never leave the form stuck.
      result = { kind: 'failed' };
    } finally {
      inFlight.current = false;
      setSending(false);
    }
    if (result.kind !== 'answer') {
      // Keep the draft so the learner can retry deliberately; the alert explains why.
      setProblem(result.kind);
      setAnnouncement({ text: '' });
      return;
    }

    // Stop ongoing speech when a new answer arrives so speech does not obscure new-message announcements (T3-011)
    stopPlayback();

    const { reply } = result;
    setEntries((current) => [
      ...current,
      { id: `${reply.id}-question`, speaker: 'learner', text: question },
      {
        id: reply.id,
        speaker: 'assistant',
        text: reply.text,
        lang: reply.lang,
        createdAt: reply.createdAt,
        ...(reply.citations ? { citations: reply.citations } : {}),
        ...(reply.provider ? { provider: reply.provider } : {}),
        ...((reply.simpleLanguage ?? isSimpleLanguage) ? { simpleLanguage: true } : {}),
        ...(reply.provenance ? { provenance: reply.provenance } : {}),
      },
    ]);
    setDraft('');
    // Announced once, as a whole; focus stays wherever the learner left it.
    setAnnouncement({
      prefix: lookup(localeRef.current, 'assistant.announcePrefix'),
      text: reply.text,
      lang: reply.lang,
    });
  }

  function handleEscape(): boolean {
    if (voiceState === 'recording') {
      discardVoice();
      return true;
    }
    if (voiceProblem) {
      setVoiceProblem(null);
      return true;
    }
    if (playbackState === 'playing' || playbackState === 'paused') {
      stopPlayback();
      return true;
    }
    if (speechProblem) {
      setSpeechProblem(null);
      return true;
    }
    if (problem) {
      setProblem(null);
      return true;
    }
    return false;
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Escape') {
      if (handleEscape()) {
        event.preventDefault();
        return;
      }
    }
    // Enter sends; Shift+Enter adds a line. Ignore Enter while an input method
    // (for example an Amharic keyboard) is still composing a character.
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void send();
  }

  return (
    <section
      className="assistant"
      aria-labelledby={ids.heading}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && handleEscape()) {
          event.stopPropagation();
        }
      }}
    >
      <h2 id={ids.heading}>
        <T k="assistant.heading" />
      </h2>

      {isResearchMode ? (
        <p className="assistant-mode-notice assistant-research-notice" role="note">
          <T k="assistant.researchModeNotice" />
        </p>
      ) : (
        <>
          {mode === 'faq' && (
            <p className="assistant-mode-notice" role="note">
              <T k="assistant.modeNotice" />
            </p>
          )}

          {mode === 'online' && (
            <p className="assistant-mode-notice" role="note">
              <T k="assistant.onlineModeNotice" />
            </p>
          )}

          {mode === 'local' && (
            <p className="assistant-mode-notice assistant-local-notice" role="note">
              <T k="assistant.localModeNotice" />
            </p>
          )}
        </>
      )}

      {isSimpleLanguage && (
        <p className="assistant-simple-language-notice" role="note">
          <T k="assistant.simpleLanguageNotice" />
        </p>
      )}

      {mode === 'local' ? (
        <div className="assistant-local-status" role="status">
          <p className="hint">
            <T k="assistant.localZeroDataNotice" />
          </p>
        </div>
      ) : onConsentChange ? (
        <div className="assistant-consent-control">
          <label htmlFor={ids.consent}>
            <input
              id={ids.consent}
              type="checkbox"
              checked={consent ?? false}
              aria-describedby={ids.consentHint}
              onChange={(e) => onConsentChange(e.target.checked)}
            />
            <T k="assistant.consentLabel" />
          </label>
          <p id={ids.consentHint} className="hint">
            <T k="assistant.consentHint" />
          </p>
        </div>
      ) : null}

      {/* Speech preferences and cloud consent (T3-011) */}
      <div
        className="speech-settings"
        role="region"
        aria-label={t('assistant.speechControlsLabel')}
      >
        <label htmlFor={ids.speechEngine}>
          <T k="assistant.speechEngineLabel" />
        </label>
        <select
          id={ids.speechEngine}
          value={speechEngine}
          onChange={(event) => {
            stopPlayback();
            setSpeechEngine(event.target.value as 'client' | 'cloud');
          }}
        >
          <option value="client">{t('assistant.speechEngineClient')}</option>
          <option value="cloud">{t('assistant.speechEngineCloud')}</option>
        </select>

        {speechEngine === 'cloud' && !cloudConsent && (
          <div
            className="cloud-consent-banner"
            role="region"
            aria-label={t('assistant.cloudConsentHeading')}
          >
            <p>
              <T k="assistant.cloudConsentBody" />
            </p>
            <button
              type="button"
              onClick={() => {
                setCloudConsent(true);
                onCloudConsentChange?.(true);
              }}
            >
              <T k="assistant.cloudConsentAccept" />
            </button>
          </div>
        )}

        {speechEngine === 'cloud' && cloudConsent && (
          <div className="cloud-consent-active">
            <span className="consent-badge">
              <T k="assistant.cloudConsentGranted" />
            </span>
            <button
              type="button"
              onClick={() => {
                stopPlayback();
                setCloudConsent(false);
                onCloudConsentChange?.(false);
              }}
            >
              <T k="assistant.cloudConsentRevoke" />
            </button>
          </div>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="empty">
          <T k="assistant.empty" />
        </p>
      ) : (
        <ol className="messages">
          {entries.map((entry) => {
            const isCurrentMessage = playingMessageId === entry.id;
            return (
              <li key={entry.id} className={`message message-${entry.speaker}`}>
                <p className="speaker">
                  <T
                    k={
                      entry.speaker === 'learner'
                        ? 'assistant.speakerLearner'
                        : entry.provider === 'external_web_research'
                          ? 'assistant.speakerResearch'
                          : entry.provider === 'job'
                            ? 'assistant.speakerJob'
                            : entry.provider === 'local' || mode === 'local'
                              ? 'assistant.speakerLocal'
                              : mode === 'online'
                                ? 'assistant.speakerOnline'
                                : mode === 'faq'
                                  ? 'assistant.speakerFaq'
                                  : 'assistant.speakerAssistant'
                    }
                  />
                </p>
                <p className="message-text" dir="auto" lang={entry.lang}>
                  {entry.text}
                </p>
                {entry.speaker === 'assistant' &&
                  !isAnswerLanguage(locale) &&
                  !entry.lang?.toLowerCase().startsWith(locale) && (
                    <p className="reply-language-note" role="note">
                      <T k="assistant.replyLanguageNote" />
                    </p>
                  )}
                {entry.provider === 'external_web_research' && (
                  <p className="research-provenance-disclaimer" role="note">
                    <T k="assistant.researchProvenanceNote" />
                  </p>
                )}
                {entry.citations && entry.citations.length > 0 && (
                  <div
                    className="citations"
                    role="region"
                    aria-label={t('assistant.citationsLabel')}
                  >
                    <span className="citations-label">
                      <T k="assistant.citationsLabel" />
                    </span>
                    <ul>
                      {entry.citations.map((c) => (
                        <li key={`${c.sourceId}-${c.sectionId}`} className="citation-item">
                          <cite>
                            {c.url ? (
                              <a
                                href={c.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="citation-link"
                              >
                                {c.sourceTitle} — {c.heading}
                              </a>
                            ) : (
                              `${c.sourceTitle} — ${c.heading}`
                            )}
                          </cite>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {entry.createdAt && (
                  <MessageDate instant={entry.createdAt} language={dateLanguage(entry.lang)} />
                )}

                {/* Keyboard-operable playback controls for assistant replies (T3-011) */}
                {entry.speaker === 'assistant' && (
                  <div
                    className="speech-controls"
                    role="group"
                    aria-label={t('assistant.speechControlsLabel')}
                  >
                    {(!isCurrentMessage || playbackState === 'idle') && (
                      <button
                        type="button"
                        className="speech-button speech-play"
                        onClick={() => void startSpeaking(entry)}
                        aria-label={`${t('assistant.speechPlay')}: ${entry.text.slice(0, 30)}`}
                      >
                        <T k="assistant.speechPlay" />
                      </button>
                    )}
                    {isCurrentMessage && playbackState === 'playing' && (
                      <>
                        <button
                          type="button"
                          className="speech-button speech-pause"
                          onClick={pauseSpeaking}
                          aria-label={t('assistant.speechPause')}
                        >
                          <T k="assistant.speechPause" />
                        </button>
                        <button
                          type="button"
                          className="speech-button speech-stop"
                          onClick={stopSpeaking}
                          aria-label={t('assistant.speechStop')}
                        >
                          <T k="assistant.speechStop" />
                        </button>
                        <span className="speech-status">
                          <T k="assistant.speechPlaying" />
                        </span>
                      </>
                    )}
                    {isCurrentMessage && playbackState === 'paused' && (
                      <>
                        <button
                          type="button"
                          className="speech-button speech-resume"
                          onClick={resumeSpeaking}
                          aria-label={t('assistant.speechResume')}
                        >
                          <T k="assistant.speechResume" />
                        </button>
                        <button
                          type="button"
                          className="speech-button speech-stop"
                          onClick={stopSpeaking}
                          aria-label={t('assistant.speechStop')}
                        >
                          <T k="assistant.speechStop" />
                        </button>
                        <span className="speech-status">
                          <T k="assistant.speechPaused" />
                        </span>
                      </>
                    )}
                  </div>
                )}
                {speechProblem && speechProblem.messageId === entry.id && (
                  <p className="speech-problem" role="alert">
                    <T k={SPEECH_PROBLEM_TEXT[speechProblem.kind]} />
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <form className="ask" onSubmit={onSubmit} noValidate>
        <label htmlFor={ids.question}>
          <T k="assistant.questionLabel" />
        </label>
        <p id={ids.hint} className="hint">
          <T k="assistant.hint" />
        </p>

        <textarea
          ref={textareaRef}
          id={ids.question}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            if (problem === 'empty') setProblem(null);
          }}
          onKeyDown={onKeyDown}
          readOnly={sending || voiceState === 'recording'}
          rows={3}
          dir="auto"
          aria-describedby={
            problem
              ? `${ids.hint} ${ids.problem}`
              : voiceProblem
                ? `${ids.hint} ${ids.voiceProblem}`
                : ids.hint
          }
          aria-invalid={problem === 'empty' || undefined}
        />
        {problem && (
          <p id={ids.problem} className="problem" role="alert">
            <T k={PROBLEM_TEXT[problem]} />
          </p>
        )}

        {/* Voice recording, transcribing, and review controls (T3-010-B) */}
        <div className="voice-controls" role="region" aria-label={t('assistant.voiceRecord')}>
          {voiceState === 'idle' && (
            <button
              type="button"
              className="voice-button voice-record"
              onClick={() => {
                void startVoiceRecording();
              }}
              aria-label={t('assistant.voiceRecord')}
              disabled={sending}
            >
              <T k="assistant.voiceRecord" />
            </button>
          )}

          {voiceState === 'recording' && (
            <div className="voice-active-group">
              <button
                type="button"
                className="voice-button voice-stop"
                onClick={() => {
                  void stopVoiceRecording();
                }}
                aria-label={t('assistant.voiceStop')}
              >
                <T k="assistant.voiceStop" />
              </button>
              <button
                type="button"
                className="voice-button voice-discard"
                onClick={discardVoice}
                aria-label={t('assistant.voiceDiscard')}
              >
                <T k="assistant.voiceDiscard" />
              </button>
              <span className="voice-status" role="status" aria-live="polite">
                <T k="assistant.voiceRecording" />
              </span>
            </div>
          )}

          {voiceState === 'transcribing' && (
            <span className="voice-status" role="status" aria-live="polite">
              <T k="assistant.voiceTranscribing" />
            </span>
          )}

          {voiceState === 'review' && (
            <div className="voice-review-banner" role="note">
              <p>
                <T k="assistant.voiceReviewHint" />
              </p>
              <button
                type="button"
                className="voice-button voice-discard"
                onClick={discardVoice}
                aria-label={t('assistant.voiceDiscard')}
              >
                <T k="assistant.voiceDiscard" />
              </button>
            </div>
          )}

          {voiceProblem && (
            <p id={ids.voiceProblem} className="voice-problem" role="alert">
              <T k={VOICE_PROBLEM_TEXT[voiceProblem]} />
            </p>
          )}
        </div>
        <div className="assistant-simple-language-control">
          <label htmlFor={ids.simpleLanguage}>
            <input
              id={ids.simpleLanguage}
              type="checkbox"
              checked={isSimpleLanguage}
              aria-describedby={ids.simpleLanguageHint}
              onChange={(e) => handleSimpleLanguageChange(e.target.checked)}
            />
            <T k="assistant.simpleLanguageLabel" />
          </label>
          <p id={ids.simpleLanguageHint} className="hint">
            <T k="assistant.simpleLanguageHint" />
          </p>
        </div>
        <div className="assistant-research-control">
          <label htmlFor={ids.researchMode}>
            <input
              id={ids.researchMode}
              type="checkbox"
              checked={isResearchMode}
              aria-describedby={ids.researchModeHint}
              onChange={(e) => setResearchMode(e.target.checked)}
            />
            <T k="assistant.researchModeLabel" />
          </label>
          <p id={ids.researchModeHint} className="hint">
            <T k="assistant.researchModeHint" />
          </p>
        </div>
        <div className="actions">
          {/* aria-disabled keeps the button focusable, so keyboard focus is not lost while sending. */}
          <button type="submit" aria-disabled={sending}>
            <T k="assistant.send" />
          </button>
          {sending && (
            <span className="pending" aria-hidden="true">
              <T k="assistant.waiting" />
            </span>
          )}
        </div>
      </form>

      {/* The prefix and the reply each carry their own language tag. */}
      <p
        className="visually-hidden"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-label={t('assistant.updatesLabel')}
      >
        {announcement.prefix && (
          <span lang={announcement.prefix.lang}>{announcement.prefix.text}</span>
        )}
        <span lang={announcement.lang}>{announcement.text}</span>
      </p>
    </section>
  );
}
