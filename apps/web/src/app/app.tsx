// Learner page: the conversation shell driven by labelled demo fixtures, plus a
// footer that checks API health once and reports it in a polite live region.
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

type ApiStatus = 'checking' | 'available' | 'unavailable';

const STATUS_TEXT: Record<ApiStatus, string> = {
  checking: 'Checking the API…',
  available: 'API available',
  unavailable: 'API unavailable',
};

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
  // The demo session token lives only in memory and is shared with features that call the API.
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const client = useMemo(() => createFixtureClient(scenario), [scenario]);

  useEffect(() => {
    const controller = new AbortController();
    // Abort on unmount (and StrictMode's double effect) so a stale check never updates state.
    fetchApiStatus(controller.signal).then(setStatus, () => {});
    return () => controller.abort();
  }, []);

  return (
    <>
      <main>
        <h1>Learning assistant</h1>
        <DemoSession handoffCode={handoffCode} onSession={setSessionToken} />
        <CourseContent token={sessionToken} />
        <section className="demo-notice" aria-labelledby="demo-heading">
          <h2 id="demo-heading">Demo mode</h2>
          <p>
            Replies come from labelled test fixtures. This is not a tutor, and no answer is real.
          </p>
          <label htmlFor="demo-scenario">Demo reply scenario</label>
          <select
            id="demo-scenario"
            value={scenario}
            onChange={(event) => {
              if (isFixtureScenario(event.target.value)) setScenario(event.target.value);
            }}
          >
            {Object.entries(FIXTURE_SCENARIOS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </section>
        <Assistant client={client} />
      </main>
      <footer>
        <p role="status" aria-label="Service status">
          {STATUS_TEXT[status]}
        </p>
      </footer>
    </>
  );
}
