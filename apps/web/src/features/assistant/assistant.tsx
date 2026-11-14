// Accessible conversation shell: a labelled question box, a message history and
// readable pending/error states. All text is rendered as React text, never HTML.
import {
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { LocaleContext, lookup, T, useT, type MessageKey } from '../../shared/i18n/i18n.tsx';
import type { AskResult, ConversationClient } from './conversation.ts';

interface Entry {
  readonly id: string;
  readonly speaker: 'learner' | 'assistant';
  readonly text: string;
  readonly lang?: string;
}

type Problem = 'empty' | 'denied' | 'failed';

const PROBLEM_TEXT: Record<Problem, MessageKey> = {
  empty: 'assistant.problemEmpty',
  denied: 'assistant.problemDenied',
  failed: 'assistant.problemFailed',
};

export function Assistant({ client }: { client: ConversationClient }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  // Captured as text when announced: a later language switch must not rewrite the
  // live region, or screen readers would read the reply again.
  const [announcement, setAnnouncement] = useState<{
    prefix?: { text: string; lang: string };
    text: string;
    lang?: string;
  }>({ text: '' });
  // State updates are asynchronous, so a ref blocks a second send in the same tick.
  const inFlight = useRef(false);
  const ids = { question: useId(), hint: useId(), problem: useId(), heading: useId() };
  const t = useT();
  const locale = useContext(LocaleContext);
  // A reply can arrive after a language switch; announce it in the language shown then.
  const localeRef = useRef(locale);
  useEffect(() => {
    localeRef.current = locale;
  }, [locale]);

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
    setAnnouncement(lookup(locale, 'assistant.sending'));

    let result: AskResult;
    try {
      result = await client.ask(question);
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
    const { reply } = result;
    setEntries((current) => [
      ...current,
      { id: `${reply.id}-question`, speaker: 'learner', text: question },
      { id: reply.id, speaker: 'assistant', text: reply.text, lang: reply.lang },
    ]);
    setDraft('');
    // Announced once, as a whole; focus stays wherever the learner left it.
    setAnnouncement({
      prefix: lookup(localeRef.current, 'assistant.announcePrefix'),
      text: reply.text,
      lang: reply.lang,
    });
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter adds a line. Ignore Enter while an input method
    // (for example an Amharic keyboard) is still composing a character.
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void send();
  }

  return (
    <section className="assistant" aria-labelledby={ids.heading}>
      <h2 id={ids.heading}>
        <T k="assistant.heading" />
      </h2>

      {entries.length === 0 ? (
        <p className="empty">
          <T k="assistant.empty" />
        </p>
      ) : (
        <ol className="messages">
          {entries.map((entry) => (
            <li key={entry.id} className={`message message-${entry.speaker}`}>
              <p className="speaker">
                <T
                  k={
                    entry.speaker === 'learner'
                      ? 'assistant.speakerLearner'
                      : 'assistant.speakerAssistant'
                  }
                />
              </p>
              <p className="message-text" dir="auto" lang={entry.lang}>
                {entry.text}
              </p>
            </li>
          ))}
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
          id={ids.question}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            if (problem === 'empty') setProblem(null);
          }}
          onKeyDown={onKeyDown}
          readOnly={sending}
          rows={3}
          dir="auto"
          aria-describedby={problem ? `${ids.hint} ${ids.problem}` : ids.hint}
          aria-invalid={problem === 'empty' || undefined}
        />
        {problem && (
          <p id={ids.problem} className="problem" role="alert">
            <T k={PROBLEM_TEXT[problem]} />
          </p>
        )}
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
      <p className="visually-hidden" role="status" aria-label={t('assistant.updatesLabel')}>
        {announcement.prefix && (
          <span lang={announcement.prefix.lang}>{announcement.prefix.text}</span>
        )}
        <span lang={announcement.lang}>{announcement.text}</span>
      </p>
    </section>
  );
}
