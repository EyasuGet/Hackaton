// Minimal page proving the web-to-API path: it checks API health once and
// reports the result in a polite live region so screen readers hear the change.
import { useEffect, useState } from 'react';

type ApiStatus = 'checking' | 'available' | 'unavailable';

const STATUS_TEXT: Record<ApiStatus, string> = {
  checking: 'Checking the API…',
  available: 'API available',
  unavailable: 'API unavailable',
};

async function fetchApiStatus(signal: AbortSignal): Promise<ApiStatus> {
  try {
    const response = await fetch('/api/health', { signal });
    if (!response.ok) return 'unavailable';
    const body: unknown = await response.json();
    const ok = typeof body === 'object' && body !== null && 'status' in body && body.status === 'ok';
    return ok ? 'available' : 'unavailable';
  } catch (error) {
    if (signal.aborted) throw error;
    return 'unavailable';
  }
}

export function App() {
  const [status, setStatus] = useState<ApiStatus>('checking');

  useEffect(() => {
    const controller = new AbortController();
    // Abort on unmount (and StrictMode's double effect) so a stale check never updates state.
    fetchApiStatus(controller.signal).then(setStatus, () => {});
    return () => controller.abort();
  }, []);

  return (
    <main>
      <h1>Learning assistant</h1>
      <p role="status">{STATUS_TEXT[status]}</p>
    </main>
  );
}
