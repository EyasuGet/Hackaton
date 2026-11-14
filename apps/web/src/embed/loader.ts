// Script loader for embedding the assistant iframe into a host page.
// Validates origin/schema, manages lifecycle (open/close/teardown), restores focus.
import {
  isValidOrigin,
  validateMessage,
  type EmbedConfig,
  type EmbedMessage,
} from './message-protocol.ts';

let iframe: HTMLIFrameElement | null = null;
let previousFocusedElement: HTMLElement | null = null;
const listeners: Array<() => void> = [];

let activeConfig: EmbedConfig = {
  origin: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173',
  token: '',
};

if (typeof window !== 'undefined') {
  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    onMessage(event, activeConfig);
  });
}

function cleanup() {
  listeners.forEach((remove) => remove());
  listeners.length = 0;
  if (iframe) {
    iframe.remove();
    iframe = null;
  }
}

function restoreFocus() {
  if (previousFocusedElement && document.contains(previousFocusedElement)) {
    previousFocusedElement.focus();
  } else {
    document.body.focus();
  }
}

function onMessage(event: MessageEvent<unknown>, config: EmbedConfig) {
  if (!isValidOrigin(event.origin, config.origin)) {
    console.warn(`[embed] Rejecting message from untrusted origin: ${event.origin}`);
    return;
  }

  if (!validateMessage(event.data)) {
    console.warn('[embed] Rejecting malformed message', event.data);
    return;
  }

  const message: EmbedMessage = event.data;

  switch (message.type) {
    case 'status':
      if (message.status === 'ready' && iframe && iframe.contentWindow) {
        const initMsg: EmbedMessage = { type: 'init', token: config.token };
        iframe.contentWindow.postMessage(initMsg, config.origin);
      }
      break;
    case 'close':
      previousFocusedElement = (document.activeElement as HTMLElement) || null;
      if (iframe) {
        iframe.remove();
        iframe = null;
      }
      restoreFocus();
      break;
  }
}

export function embedAssistant(config: EmbedConfig): void {
  activeConfig = config;
  // If already loaded, clean up and reload (idempotent).
  cleanup();

  // Create iframe with origin as src.
  iframe = document.createElement('iframe');
  iframe.src = config.origin;
  iframe.style.cssText = `
    position: fixed;
    bottom: 0;
    right: 0;
    width: 420px;
    height: 600px;
    max-width: 100%;
    max-height: 100%;
    border: none;
    box-shadow: -2px -2px 8px rgba(0,0,0,0.15);
    z-index: 999999;
  `;
  iframe.title = 'Learning assistant';

  // Append to body before messaging (origin must be loaded first).
  document.body.appendChild(iframe);

  // Send init message with token.
  iframe.onload = () => {
    if (iframe && iframe.contentWindow) {
      const message: EmbedMessage = { type: 'init', token: config.token };
      iframe.contentWindow.postMessage(message, config.origin);
    }
  };

  // Listen for messages from iframe.
  const handleMessage = (event: MessageEvent) => onMessage(event, config);
  window.addEventListener('message', handleMessage);
  listeners.push(() => window.removeEventListener('message', handleMessage));
}

// Expose globally for script injection.
declare global {
  function embedAssistant(config: EmbedConfig): void;
}

Object.assign(window, { embedAssistant });
