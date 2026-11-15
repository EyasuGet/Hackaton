// Script loader for embedding the assistant iframe into a host page (T3-045, T3-051).
// Validates origin/schema, supports data attributes & declarative setup, manages lifecycle.
// WCAG 2.4.11 (Focus Not Obscured): supports minimizing, auto-minimizing on host focus, and inline container placement.
import {
  isValidOrigin,
  validateMessage,
  type EmbedConfig,
  type EmbedMessage,
} from './message-protocol.ts';

let iframe: HTMLIFrameElement | null = null;
let launcherBtn: HTMLButtonElement | null = null;
let previousFocusedElement: HTMLElement | null = null;
let isMinimised = false;
let autoMinimiseEnabled = true;
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
  if (launcherBtn) {
    launcherBtn.remove();
    launcherBtn = null;
  }
  isMinimised = false;
}

function restoreFocus() {
  if (previousFocusedElement && document.contains(previousFocusedElement)) {
    previousFocusedElement.focus();
  } else if (typeof document !== 'undefined' && document.body) {
    document.body.focus();
  }
}

function minimiseAssistant() {
  if (!iframe || isMinimised) return;
  isMinimised = true;
  iframe.style.display = 'none';

  if (!launcherBtn) {
    launcherBtn = document.createElement('button');
    launcherBtn.type = 'button';
    launcherBtn.className = 'digitalbridge-assistant-launcher';
    launcherBtn.setAttribute('aria-label', 'Open Learning Assistant');
    launcherBtn.textContent = '💬 Assistant';

    const pos = activeConfig.position || 'bottom-right';
    const isLeft = pos === 'bottom-left';
    launcherBtn.style.cssText = `
      position: fixed;
      bottom: 16px;
      ${isLeft ? 'left: 16px;' : 'right: 16px;'}
      padding: 10px 16px;
      background-color: #0369a1;
      color: #ffffff;
      border: 2px solid #ffffff;
      border-radius: 24px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.25);
      font-family: system-ui, sans-serif;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      z-index: 999999;
    `;

    launcherBtn.onclick = () => {
      maximiseAssistant();
    };

    document.body.appendChild(launcherBtn);
  } else {
    launcherBtn.style.display = 'block';
  }

  restoreFocus();
}

function maximiseAssistant() {
  if (!iframe) {
    embedAssistant(activeConfig);
    return;
  }
  isMinimised = false;
  iframe.style.display = 'block';
  if (launcherBtn) {
    launcherBtn.style.display = 'none';
  }
  if (iframe.contentWindow) {
    iframe.contentWindow.focus();
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
    case 'minimize':
      minimiseAssistant();
      break;
    case 'open':
      maximiseAssistant();
      break;
    case 'close':
      previousFocusedElement = (document.activeElement as HTMLElement) || null;
      cleanup();
      restoreFocus();
      break;
  }
}

function getPlacementStyle(position?: 'bottom-right' | 'bottom-left' | 'inline'): string {
  if (position === 'inline') {
    return 'width: 100%; height: 600px; border: none; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);';
  }
  if (position === 'bottom-left') {
    return 'position: fixed; bottom: 0; left: 0; width: 420px; height: 600px; max-width: 100%; max-height: 100%; border: none; box-shadow: 2px -2px 8px rgba(0,0,0,0.15); z-index: 999999;';
  }
  return 'position: fixed; bottom: 0; right: 0; width: 420px; height: 600px; max-width: 100%; max-height: 100%; border: none; box-shadow: -2px -2px 8px rgba(0,0,0,0.15); z-index: 999999;';
}

function checkFocusObscured(focusedElement: HTMLElement | null) {
  if (!iframe || isMinimised || !focusedElement || activeConfig.position === 'inline') return;
  // If focused element is the iframe or launcher itself, do not minimize
  if (focusedElement === iframe || focusedElement === launcherBtn) return;

  const iframeRect = iframe.getBoundingClientRect();
  const elemRect = focusedElement.getBoundingClientRect();

  // Determine if element's center point is obscured by the fixed panel (WCAG 2.4.11)
  const elemCenterX = elemRect.left + elemRect.width / 2;
  const elemCenterY = elemRect.top + elemRect.height / 2;

  const isObscured =
    elemCenterX >= iframeRect.left &&
    elemCenterX <= iframeRect.right &&
    elemCenterY >= iframeRect.top &&
    elemCenterY <= iframeRect.bottom;

  if (isObscured && autoMinimiseEnabled) {
    minimiseAssistant();
  }
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
    container: config && config.container,
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

  // Mount to custom container if inline, otherwise to body
  if (resolvedConfig.position === 'inline' && resolvedConfig.container) {
    const targetContainer =
      typeof resolvedConfig.container === 'string'
        ? document.querySelector(resolvedConfig.container)
        : resolvedConfig.container;
    if (targetContainer) {
      targetContainer.appendChild(iframe);
    } else {
      document.body.appendChild(iframe);
    }
  } else {
    document.body.appendChild(iframe);
  }

  iframe.onload = () => {
    if (iframe && iframe.contentWindow) {
      const message: EmbedMessage = { type: 'init', token: resolvedConfig.token };
      iframe.contentWindow.postMessage(message, targetOrigin);
    }
  };

  const handleMessage = (event: MessageEvent) => onMessage(event, resolvedConfig);
  window.addEventListener('message', handleMessage);
  listeners.push(() => window.removeEventListener('message', handleMessage));

  // Host focus tracking for WCAG 2.4.11 (Focus Not Obscured)
  const handleHostFocus = () => {
    const active = document.activeElement as HTMLElement | null;
    checkFocusObscured(active);
  };
  window.addEventListener('focusin', handleHostFocus);
  listeners.push(() => window.removeEventListener('focusin', handleHostFocus));
}

// Global declaration
declare global {
  function embedAssistant(config?: Partial<EmbedConfig>): void;
}

if (typeof window !== 'undefined') {
  Object.assign(window, {
    embedAssistant,
    minimiseAssistant,
    maximiseAssistant,
    setAutoMinimise: (enabled: boolean) => {
      autoMinimiseEnabled = enabled;
    },
  });

  // Declarative embed
  if (currentScript && currentScript.getAttribute('data-auto') === 'true') {
    const autoCourse = currentScript.getAttribute('data-course') || undefined;
    const autoLang = currentScript.getAttribute('data-lang') || undefined;
    const autoPosition =
      (currentScript.getAttribute('data-position') as 'bottom-right' | 'bottom-left' | 'inline') ||
      'bottom-right';
    const autoContainer = currentScript.getAttribute('data-container') || undefined;
    const autoToken = currentScript.getAttribute('data-token') || '';
    embedAssistant({
      origin: scriptOrigin ?? '',
      token: autoToken,
      course: autoCourse,
      lang: autoLang,
      position: autoPosition,
      container: autoContainer,
    });
  }

  // Keyboard shortcut helper: Alt+Shift+A
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.altKey && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
      if (!iframe || isMinimised) {
        maximiseAssistant();
      } else if (iframe.contentWindow) {
        iframe.contentWindow.focus();
      }
    }
  });
}
