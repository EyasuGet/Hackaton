// Script loader for embedding the assistant iframe into a host page (T3-045).
// Validates origin/schema, supports data attributes & declarative setup, manages lifecycle.
import {
  isValidOrigin,
  validateMessage,
  type EmbedConfig,
  type EmbedMessage,
} from './message-protocol.ts';

let iframe: HTMLIFrameElement | null = null;
let previousFocusedElement: HTMLElement | null = null;
const listeners: Array<() => void> = [];

// Resolve origin from current script tag or fail closed.
const currentScript = ((): HTMLScriptElement | null => {
  if (typeof document !== 'undefined' && document.currentScript) {
    return document.currentScript as HTMLScriptElement;
  }
  if (typeof document !== 'undefined') {
    const scripts = document.getElementsByTagName('script');
    for (let i = scripts.length - 1; i >= 0; i--) {
      const s = scripts[i];
      if (s && s.src && s.src.includes('loader.js')) {
        return s;
      }
    }
  }
  return null;
})();

const scriptOrigin = ((): string | null => {
  try {
    if (currentScript && currentScript.src) {
      return new URL(currentScript.src).origin;
    }
    if (typeof window !== 'undefined' && window.location) {
      return window.location.origin;
    }
  } catch {
    // ignore
  }
  return null;
})();

let activeConfig: EmbedConfig = {
  origin: scriptOrigin ?? '',
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
  } else if (typeof document !== 'undefined' && document.body) {
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

function getPlacementStyle(position?: 'bottom-right' | 'bottom-left'): string {
  if (position === 'bottom-left') {
    return 'position: fixed; bottom: 0; left: 0; width: 420px; height: 600px; max-width: 100%; max-height: 100%; border: none; box-shadow: 2px -2px 8px rgba(0,0,0,0.15); z-index: 999999;';
  }
  return 'position: fixed; bottom: 0; right: 0; width: 420px; height: 600px; max-width: 100%; max-height: 100%; border: none; box-shadow: -2px -2px 8px rgba(0,0,0,0.15); z-index: 999999;';
}

export function embedAssistant(config?: Partial<EmbedConfig>): void {
  const targetOrigin = (config && config.origin) || scriptOrigin;
  if (!targetOrigin) {
    console.error(
      '[embed] Cannot resolve assistant origin. Specify { origin: "https://..." } or load from a valid script URL.',
    );
    return;
  }

  const resolvedConfig: EmbedConfig = {
    origin: targetOrigin,
    token: (config && config.token) || '',
    course: config && config.course,
    lang: config && config.lang,
    position: (config && config.position) || 'bottom-right',
    allow: config && config.allow,
    sandbox: config && config.sandbox,
  };

  activeConfig = resolvedConfig;
  cleanup();

  iframe = document.createElement('iframe');

  const queryParams: string[] = [];
  if (resolvedConfig.course)
    queryParams.push(`course=${encodeURIComponent(resolvedConfig.course)}`);
  if (resolvedConfig.lang) queryParams.push(`lang=${encodeURIComponent(resolvedConfig.lang)}`);
  const qs = queryParams.length > 0 ? `?${queryParams.join('&')}` : '';

  iframe.src = `${targetOrigin}${qs}`;
  iframe.style.cssText = getPlacementStyle(resolvedConfig.position);
  iframe.title = 'Learning assistant';
  iframe.allow = resolvedConfig.allow ?? 'microphone; display-capture';
  if (resolvedConfig.sandbox !== undefined) {
    iframe.setAttribute('sandbox', resolvedConfig.sandbox);
  }

  document.body.appendChild(iframe);

  iframe.onload = () => {
    if (iframe && iframe.contentWindow) {
      const message: EmbedMessage = { type: 'init', token: resolvedConfig.token };
      iframe.contentWindow.postMessage(message, targetOrigin);
    }
  };

  const handleMessage = (event: MessageEvent) => onMessage(event, resolvedConfig);
  window.addEventListener('message', handleMessage);
  listeners.push(() => window.removeEventListener('message', handleMessage));
}

// Global declaration
declare global {
  function embedAssistant(config?: Partial<EmbedConfig>): void;
}

if (typeof window !== 'undefined') {
  Object.assign(window, { embedAssistant });

  // Declarative embed
  if (currentScript && currentScript.getAttribute('data-auto') === 'true') {
    const autoCourse = currentScript.getAttribute('data-course') || undefined;
    const autoLang = currentScript.getAttribute('data-lang') || undefined;
    const autoPosition =
      (currentScript.getAttribute('data-position') as 'bottom-right' | 'bottom-left') ||
      'bottom-right';
    const autoToken = currentScript.getAttribute('data-token') || '';
    embedAssistant({
      origin: scriptOrigin ?? '',
      token: autoToken,
      course: autoCourse,
      lang: autoLang,
      position: autoPosition,
    });
  }

  // Keyboard shortcut helper: Alt+Shift+A
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.altKey && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
      if (!iframe) {
        embedAssistant(activeConfig);
      } else if (iframe.contentWindow) {
        iframe.contentWindow.focus();
      }
    }
  });
}
