// Standalone script loader for embedding the assistant iframe into a host page.
// Validates origin/schema, manages lifecycle (open/close/teardown), restores focus.
/* global window, document, console, URL */
(function () {
  let iframe = null;
  let previousFocusedElement = null;

  const scriptOrigin = (function () {
    try {
      if (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) {
        return new URL(document.currentScript.src).origin;
      }
    } catch {
      // ignore
    }
    return 'http://localhost:5173';
  })();

  let activeConfig = {
    origin: scriptOrigin,
    token: '',
  };

  function cleanup() {
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

  function isValidOrigin(actual, expected) {
    return actual === expected && !actual.includes('null') && actual.startsWith('http');
  }

  function validateMessage(data) {
    if (!data || typeof data !== 'object') return false;
    if (!('type' in data) || typeof data.type !== 'string') return false;
    switch (data.type) {
      case 'init':
        return 'token' in data && typeof data.token === 'string';
      case 'open':
      case 'close':
        return true;
      case 'status':
        return 'status' in data && (data.status === 'ready' || data.status === 'closed');
      default:
        return false;
    }
  }

  function onMessage(event, config) {
    const expectedOrigin = config && config.origin ? config.origin : activeConfig.origin;
    if (!isValidOrigin(event.origin, expectedOrigin)) {
      console.warn('[embed] Rejecting message from untrusted origin: ' + event.origin);
      return;
    }

    if (!validateMessage(event.data)) {
      console.warn('[embed] Rejecting malformed message', event.data);
      return;
    }

    if (event.data.type === 'status' && event.data.status === 'ready') {
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage(
          { type: 'init', token: (config || activeConfig).token },
          expectedOrigin,
        );
      }
    }

    if (event.data.type === 'close') {
      previousFocusedElement = document.activeElement || null;
      if (iframe) {
        iframe.remove();
        iframe = null;
      }
      restoreFocus();
    }
  }

  window.addEventListener('message', function (event) {
    onMessage(event, activeConfig);
  });

  function embedAssistant(config) {
    activeConfig = config;
    cleanup();

    iframe = document.createElement('iframe');
    iframe.src = config.origin;
    iframe.style.cssText = [
      'position: fixed',
      'bottom: 0',
      'right: 0',
      'width: 420px',
      'height: 600px',
      'max-width: 100%',
      'max-height: 100%',
      'border: none',
      'box-shadow: -2px -2px 8px rgba(0,0,0,0.15)',
      'z-index: 999999',
    ].join('; ');
    iframe.title = 'Learning assistant';

    document.body.appendChild(iframe);

    iframe.onload = function () {
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type: 'init', token: config.token }, config.origin);
      }
    };
  }

  window.embedAssistant = embedAssistant;
})();
