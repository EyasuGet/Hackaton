// Learner page: the conversation shell driven by labelled demo fixtures, an
// Amharic/English language switch, and a footer that checks API health once and
// reports it in a polite live region.
import { useEffect, useMemo, useState } from 'react';
import { Assistant } from '../features/assistant/assistant.tsx';
import { CourseContent } from '../features/course-content/course-content.tsx';
import { DemoSession } from '../features/demo-session/demo-session.tsx';
import {
  createFixtureClient,
  FIXTURE_SCENARIOS,
  isFixtureScenario,
  type FixtureScenario,
} from '../features/assistant/fixture-client.ts';
import { LocaleContext, lookup, T, type Locale, type MessageKey } from '../shared/i18n/i18n.tsx';

type ApiStatus = 'checking' | 'available' | 'unavailable';

const STATUS_TEXT: Record<ApiStatus, MessageKey> = {
  checking: 'status.checking',
  available: 'status.available',
  unavailable: 'status.unavailable',
};

// Each language is named in itself, so a learner can find their own whatever is showing.
const LANGUAGES: readonly { locale: Locale; name: string }[] = [
  { locale: 'en', name: 'English' },
  { locale: 'am', name: 'አማርኛ' },
];

// A hung API must not leave the page on "Checking" forever.
export const HEALTH_TIMEOUT_MS = 5000;

async function fetchApiStatus(signal: AbortSignal): Promise<ApiStatus> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), HEALTH_TIMEOUT_MS);
  try {
    const response = await fetch('/api/health', {
      signal: AbortSignal.any([signal, timeout.signal]),
    });
    if (!response.ok) return 'unavailable';
    const body: unknown = await response.json();
    const ok =
      typeof body === 'object' && body !== null && 'status' in body && body.status === 'ok';
    return ok ? 'available' : 'unavailable';
  } catch (error) {
    // Unmount aborts propagate; network failures and timeouts mean unavailable.
    if (signal.aborted) throw error;
    return 'unavailable';
  } finally {
    clearTimeout(timer);
  }
}

/** `handoffCode` is the one-time demo sign-in code taken from the URL at startup. */
export function App({ handoffCode = null }: { handoffCode?: string | null }) {
  const [status, setStatus] = useState<ApiStatus>('checking');
  const [scenario, setScenario] = useState<FixtureScenario>('english');
  const [locale, setLocale] = useState<Locale>('en');
  // The demo session token lives only in memory and is shared with features that call the API.
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const client = useMemo(() => createFixtureClient(scenario), [scenario]);
  const t = (key: MessageKey) => lookup(locale, key).text;

  // The page language drives screen-reader pronunciation and font selection.
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = lookup(locale, 'app.title').text;
  }, [locale]);

  useEffect(() => {
    const controller = new AbortController();
    // Abort on unmount (and StrictMode's double effect) so a stale check never updates state.
    fetchApiStatus(controller.signal).then(setStatus, () => {});
    return () => controller.abort();
  }, []);

  // The Assistant is never remounted on a language switch, so an unsent question survives it.
  return (
    <LocaleContext value={locale}>
      <main>
        <div className="languages" role="group" aria-label={t('app.languageLabel')}>
          {LANGUAGES.map(({ locale: option, name }) => (
            <button
              key={option}
              type="button"
              lang={option}
              aria-pressed={locale === option}
              onClick={() => setLocale(option)}
            >
              {name}
            </button>
          ))}
        </div>
        <h1>
          <T k="app.title" />
        </h1>
        <DemoSession handoffCode={handoffCode} onSession={setSessionToken} />
        <CourseContent token={sessionToken} />
        <section className="demo-notice" aria-labelledby="demo-heading">
          <h2 id="demo-heading">
            <T k="demo.heading" />
          </h2>
          <p>
            <T k="demo.notice" />
          </p>
          <label htmlFor="demo-scenario">
            <T k="demo.scenarioLabel" />
          </label>
          <select
            id="demo-scenario"
            value={scenario}
            onChange={(event) => {
              if (isFixtureScenario(event.target.value)) setScenario(event.target.value);
            }}
          >
            {/* An option holds plain text only, so these use the untagged lookup. */}
            {Object.entries(FIXTURE_SCENARIOS).map(([value, label]) => (
              <option key={value} value={value}>
                {t(label)}
              </option>
            ))}
          </select>
        </section>
        <Assistant client={client} />
      </main>
      <footer>
        <p role="status" aria-label={t('status.label')}>
          <T k={STATUS_TEXT[status]} />
        </p>
      </footer>
    </LocaleContext>
  );
}
