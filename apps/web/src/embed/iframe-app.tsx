// Headless assistant running inside iframe. Receives handoff code or token from parent,
// instantiates App with authenticated client, handles close signals.
import { useEffect, useState } from 'react';
import { App } from '../app/app.tsx';
import { validateMessage } from './message-protocol.ts';

export function IframeApp() {
  const [token, setToken] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    // Listen for init message from parent.
    function handleMessage(event: MessageEvent<unknown>) {
      if (!validateMessage(event.data)) {
        window.parent.postMessage(event.data, '*');
        return;
      }
      const msg = event.data;

      if (msg.type === 'init' && 'token' in msg) {
        setToken(msg.token);
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

  const handleClose = () => {
    window.parent.postMessage({ type: 'close' }, '*');
    window.close?.();
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        overflow: 'hidden',
      }}
    >
      <div style={{ flex: 1, overflow: 'auto', padding: '0.5rem' }}>
        <App handoffCode={token} isEmbedded={true} onClose={handleClose} />
      </div>
      <footer
        style={{
          padding: '0.5rem',
          borderTop: '1px solid #ddd',
          textAlign: 'center',
          background: '#fff',
        }}
      >
        <button type="button" onClick={handleClose}>
          Close
        </button>
      </footer>
    </div>
  );
}
