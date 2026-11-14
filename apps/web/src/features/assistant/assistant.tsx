// Accessible conversation shell: a labelled question box, a message history and
// readable pending/error states. All text is rendered as React text, never HTML.
import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { formatAddisDate, type DateLanguage } from '../../shared/i18n/addis-date.ts';
import type { AskResult, ConversationClient } from './conversation.ts';

interface Entry {
  readonly id: string;
  readonly speaker: 'learner' | 'assistant';
  readonly text: string;
  readonly lang?: string;
  readonly createdAt?: string;
}

type Problem = 'empty' | 'denied' | 'failed';

const PROBLEM_TEXT: Record<Problem, string> = {
  empty: 'Type a question before sending.',
  denied:
    'You are not signed in, or your session has expired. Your question was not sent and is still in the box.',
  failed:
    'Your question could not be sent. Check your connection, then press Send to try again. Your question is still in the box.',
};

// Shell labels stay English until T3-006-C owns the shared translation dictionary;
// the date values themselves follow the reply language.
const DATE_LABELS = {
  ethiopian: 'Ethiopian calendar',
  gregorian: 'Gregorian',
  timeZone: 'Addis Ababa time',
} as const;

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
        <span lang={language}>{date.ethiopian}</span> ({DATE_LABELS.ethiopian})
        <span aria-hidden="true"> · </span>
        <span lang={language}>{date.gregorian}</span> ({DATE_LABELS.gregorian})
        <span aria-hidden="true"> · </span>
        <span>{date.addisAbabaTime}</span> {DATE_LABELS.timeZone}
      </time>
    </p>
  );
}

export function Assistant({ client }: { client: ConversationClient }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [announcement, setAnnouncement] = useState<{ prefix: string; text: string; lang?: string }>(
    { prefix: '', text: '' },
  );
  // State updates are asynchronous, so a ref blocks a second send in the same tick.
  const inFlight = useRef(false);
  const ids = { question: useId(), hint: useId(), problem: useId(), heading: useId() };

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
    setAnnouncement({ prefix: '', text: 'Sending your question…' });

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
      setAnnouncement({ prefix: '', text: '' });
      return;
    }
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
      },
    ]);
    setDraft('');
    // Announced once, as a whole; focus stays wherever the learner left it.
    setAnnouncement({ prefix: 'Assistant: ', text: reply.text, lang: reply.lang });
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
      <h2 id={ids.heading}>Conversation</h2>

      {entries.length === 0 ? (
        <p className="empty">No messages yet. Ask a question about your course below.</p>
      ) : (
        <ol className="messages">
          {entries.map((entry) => (
            <li key={entry.id} className={`message message-${entry.speaker}`}>
              <p className="speaker">{entry.speaker === 'learner' ? 'You' : 'Assistant (demo)'}</p>
              <p className="message-text" dir="auto" lang={entry.lang}>
                {entry.text}
              </p>
              {entry.createdAt && (
                <MessageDate instant={entry.createdAt} language={dateLanguage(entry.lang)} />
              )}
            </li>
          ))}
        </ol>
      )}

      <form className="ask" onSubmit={onSubmit} noValidate>
        <label htmlFor={ids.question}>Your question</label>
        <p id={ids.hint} className="hint">
          Press Enter to send, or Shift+Enter for a new line.
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
            {PROBLEM_TEXT[problem]}
          </p>
        )}
        <div className="actions">
          {/* aria-disabled keeps the button focusable, so keyboard focus is not lost while sending. */}
          <button type="submit" aria-disabled={sending}>
            Send
          </button>
          {sending && (
            <span className="pending" aria-hidden="true">
              Waiting for a reply…
            </span>
          )}
        </div>
      </form>

      {/* The English prefix and the reply carry their own language tags. */}
      <p className="visually-hidden" role="status" aria-label="Conversation updates">
        {announcement.prefix}
        <span lang={announcement.lang}>{announcement.text}</span>
      </p>
    </section>
  );
}
