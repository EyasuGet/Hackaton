// Headless assistant running inside iframe. Receives token from parent,
// instantiates Assistant with authenticated client, handles close signals.
import { useEffect, useMemo, useState } from 'react';
import { Assistant } from '../features/assistant/assistant.tsx';
import { createFixtureClient } from '../features/assistant/fixture-client.ts';
import { validateMessage } from './message-protocol.ts';

export function IframeApp() {
  const [initialized, setInitialized] = useState(false);
  const client = useMemo(() => createFixtureClient('english'), []);

  useEffect(() => {
    // Listen for init message from parent.
    function handleMessage(event: MessageEvent<unknown>) {
      if (!validateMessage(event.data)) {
        window.parent.postMessage(event.data, '*');
        return;
      }
      const msg = event.data;

      if (msg.type === 'init' && 'token' in msg) {
        // Token is received but fixture uses demo data; in a real app,
        // pass it to the conversation client for authentication.
        setInitialized(true);
        // Send ready status back to parent.
        window.parent.postMessage({ type: 'status', status: 'ready' }, '*');
      }

      if (msg.type === 'close') {
        window.parent.postMessage({ type: 'status', status: 'closed' }, '*');
      }
    }

    window.addEventListener('message', handleMessage);
    // Notify parent that iframe is mounted and ready for init.
    window.parent.postMessage({ type: 'status', status: 'ready' }, '*');
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  if (!initialized) {
    return <div style={{ padding: '1rem', textAlign: 'center', color: '#666' }}>Initializing…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <main style={{ flex: 1, overflow: 'auto', padding: '1rem' }}>
        <h1>Learning assistant</h1>
        <Assistant client={client} />
      </main>
      <footer style={{ padding: '1rem', borderTop: '1px solid #ddd', textAlign: 'center' }}>
        <button
          onClick={() => {
            window.parent.postMessage({ type: 'close' }, '*');
            window.close?.();
          }}
        >
          Close
        </button>
      </footer>
    </div>
  );
}
