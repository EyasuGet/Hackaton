// Learner page: the conversation shell driven by labelled demo fixtures or
// real course FAQ mode when authenticated, a language switch (English, Amharic and
// draft Afaan Oromo, Tigrinya, Somali and Arabic),
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
import { SupportQueue } from '../features/human-help/support-queue.tsx';
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
import {
  LocaleContext,
  localeDirection,
  lookup,
  T,
  type Locale,
  type MessageKey,
} from '../shared/i18n/i18n.tsx';
import { LOCALE_REVIEW } from '../shared/i18n/messages.ts';
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
  { locale: 'om', name: 'Afaan Oromoo' },
  { locale: 'ti', name: 'ትግርኛ' },
  { locale: 'so', name: 'Soomaali' },
  { locale: 'ar', name: 'العربية' },
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
  const [localMode] = useState<boolean>(
    () =>
      loadStoredPreferences().localMode ??
      (typeof window !== 'undefined' &&
        (window.location.search.includes('mode=local') ||
          window.location.search.includes('local=true') ||
          window.location.search.includes('provider=local'))),
  );

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

  // The page language drives screen-reader pronunciation and font selection; the
  // direction mirrors the whole layout for Arabic.
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = localeDirection(locale);
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
      <div className="app-shell">
        <header className="app-header">
          <div className="header-inner">
            <div className="brand-group">
              <span className="brand-icon" aria-hidden="true">
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                </svg>
              </span>
              <div className="brand-text">
                <h1>
                  <T k="app.title" />
                </h1>
                <p className="app-subtitle">Multilingual Learning &amp; Assistance Platform</p>
              </div>
            </div>
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
          </div>
        </header>

        <main className="main-content">
          {LOCALE_REVIEW[locale] === 'draft' && (
            <p className="translation-draft-notice" role="note">
              <T k="app.translationDraft" />
            </p>
          )}
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

          <div className="demo-strip">
            <DemoSession handoffCode={handoffCode} onSession={setSessionToken} />

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
          </div>

          <div
            className={`workspace-grid ${sessionToken ? 'workspace-grid--authenticated' : 'workspace-grid--demo'}`}
          >
            <div className="workspace-column workspace-column--primary">
              <CourseContent token={sessionToken} />
              <Assistant
                client={client}
                researchClient={researchClient}
                mode={
                  sessionToken ? (localMode ? 'local' : externalConsent ? 'online' : 'faq') : 'demo'
                }
                consent={externalConsent}
                simpleLanguage={simpleLanguage}
                onSimpleLanguageChange={setSimpleLanguage}
                {...(sessionToken
                  ? { onConsentChange: (consented: boolean) => setExternalConsent(consented) }
                  : {})}
              />
            </div>
            {sessionToken && (
              <div className="workspace-column workspace-column--secondary">
                <HumanHelp token={sessionToken} />
                <HelpInbox token={sessionToken} />
                <AccommodationPanel token={sessionToken} />
                <TeacherTopics token={sessionToken} />
                <EmployerDashboard sessionToken={sessionToken} />
                <SupportQueue token={sessionToken} />
              </div>
            )}
          </div>
        </main>

        <footer className="app-footer">
          <div className="footer-inner">
            <p role="status" aria-label={t('status.label')}>
              <T k={STATUS_TEXT[status]} />
            </p>
            <p className="footer-meta">
              Savanna Multilingual Learning Assistant · WCAG 2.2 AA Conforming
            </p>
          </div>
        </footer>
      </div>
    </LocaleContext>
  );
}
