// Learner page: the conversation shell driven by labelled demo fixtures or
// real course FAQ mode when authenticated, an Amharic/English language switch,
// and a footer that checks API health once and reports it in a polite live region.
import { useEffect, useMemo, useState } from 'react';
import { Assistant } from '../features/assistant/assistant.tsx';
import { CourseContent } from '../features/course-content/course-content.tsx';
import { DemoSession } from '../features/demo-session/demo-session.tsx';
import { AccommodationPanel } from '../features/accommodation/accommodation.tsx';
import { HelpInbox } from '../features/human-help/help-inbox.tsx';
import { HumanHelp } from '../features/human-help/human-help.tsx';
import { TeacherTopics } from '../features/teacher/teacher-topics.tsx';
import { EmployerDashboard } from '../features/employer/employer-dashboard.tsx';
import {
  createAnswerClient,
  createCareerResearchClient,
} from '../features/assistant/faq-client.ts';
import {
  createFixtureClient,
  FIXTURE_SCENARIOS,
  isFixtureScenario,
  type FixtureScenario,
} from '../features/assistant/fixture-client.ts';
import { LocaleContext, lookup, T, type Locale, type MessageKey } from '../shared/i18n/i18n.tsx';
import { loadStoredPreferences, saveStoredPreferences } from './preferences.ts';
import { useServiceWorkerUpdate } from './service-worker.ts';

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
  const [scenario, setScenarioState] = useState<FixtureScenario>(
    () => loadStoredPreferences().scenario ?? 'english',
  );
  const [locale, setLocaleState] = useState<Locale>(() => loadStoredPreferences().locale ?? 'en');
  const [simpleLanguage, setSimpleLanguageState] = useState<boolean>(
    () => loadStoredPreferences().simpleLanguage ?? false,
  );
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  // The demo session token lives only in memory and is shared with features that call the API.
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [externalConsent, setExternalConsent] = useState(false);

  const { updateAvailable, applyUpdate } = useServiceWorkerUpdate();

  const setLocale = (newLocale: Locale) => {
    setLocaleState(newLocale);
    saveStoredPreferences({ locale: newLocale });
  };

  const setScenario = (newScenario: FixtureScenario) => {
    setScenarioState(newScenario);
    saveStoredPreferences({ scenario: newScenario });
  };

  const setSimpleLanguage = (enabled: boolean) => {
    setSimpleLanguageState(enabled);
    saveStoredPreferences({ simpleLanguage: enabled });
  };

  // When a valid learner session token is present, connect the Assistant to real course answers
  // using course-1 (Savanna Virtual Assistant) by default, while supporting fixture override.
  const client = useMemo(() => {
    if (sessionToken) {
      return createAnswerClient({
        courseId: 'course-1',
        getToken: () => sessionToken,
        getConsent: () => externalConsent,
        getSimpleLanguage: () => simpleLanguage,
      });
    }
    return createFixtureClient(scenario);
  }, [sessionToken, scenario, externalConsent, simpleLanguage]);

  const researchClient = useMemo(() => {
    if (sessionToken) {
      return createCareerResearchClient({
        getToken: () => sessionToken,
      });
    }
    return createFixtureClient(
      scenario === 'researchLimitation' ? 'researchLimitation' : 'researchSuccess',
    );
  }, [sessionToken, scenario]);

  const t = (key: MessageKey) => lookup(locale, key).text;

  useEffect(() => {
    const goOffline = () => setIsOffline(true);
    const goOnline = () => setIsOffline(false);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

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
        {isOffline && (
          <p role="status" aria-live="polite" className="offline-banner">
            <T k="app.offline" />
          </p>
        )}
        {updateAvailable && (
          <div
            role="status"
            aria-live="polite"
            aria-label={t('app.updateAvailable')}
            className="update-banner"
          >
            <p>
              <T k="app.updateAvailable" />
            </p>
            <button type="button" onClick={applyUpdate}>
              <T k="app.refresh" />
            </button>
          </div>
        )}
        <DemoSession handoffCode={handoffCode} onSession={setSessionToken} />
        <CourseContent token={sessionToken} />
        {!sessionToken && (
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
        )}
        <Assistant
          client={client}
          researchClient={researchClient}
          mode={sessionToken ? (externalConsent ? 'online' : 'faq') : 'demo'}
          consent={externalConsent}
          simpleLanguage={simpleLanguage}
          onSimpleLanguageChange={setSimpleLanguage}
          {...(sessionToken
            ? { onConsentChange: (consented: boolean) => setExternalConsent(consented) }
            : {})}
        />
        {sessionToken && <HumanHelp token={sessionToken} />}
        {sessionToken && <HelpInbox token={sessionToken} />}
        {sessionToken && <AccommodationPanel token={sessionToken} />}
        {sessionToken && <TeacherTopics token={sessionToken} />}
        {sessionToken && <EmployerDashboard sessionToken={sessionToken} />}
      </main>
      <footer>
        <p role="status" aria-label={t('status.label')}>
          <T k={STATUS_TEXT[status]} />
        </p>
      </footer>
    </LocaleContext>
  );
}
