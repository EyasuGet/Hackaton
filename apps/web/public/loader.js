// Standalone script loader for embedding the assistant iframe into a host page (T3-045).
// Validates origin/schema, supports data attributes & declarative setup, manages lifecycle.
/* global window, document, console, URL */
(function () {
  let iframe = null;
  let previousFocusedElement = null;

  // Resolve origin from current script tag or fail closed.
  const currentScript = (function () {
    if (typeof document !== 'undefined' && document.currentScript) {
      return document.currentScript;
    }
    // Fallback search for script tag with loader.js
    if (typeof document !== 'undefined') {
      const scripts = document.getElementsByTagName('script');
      for (let i = scripts.length - 1; i >= 0; i--) {
        if (scripts[i].src && scripts[i].src.includes('loader.js')) {
          return scripts[i];
        }
      }
    }
    return null;
  })();

  const scriptOrigin = (function () {
    try {
      if (currentScript && currentScript.src) {
        return new URL(currentScript.src).origin;
      }
    } catch {
      // ignore
    }
    return null;
  })();

  let activeConfig = {
    origin: scriptOrigin,
    token: '',
    position: 'bottom-right',
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
    } else if (typeof document !== 'undefined' && document.body) {
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

  if (typeof window !== 'undefined') {
    window.addEventListener('message', function (event) {
      onMessage(event, activeConfig);
    });
  }

  function getPlacementStyle(position) {
    if (position === 'bottom-left') {
      return 'position: fixed; bottom: 0; left: 0; width: 420px; height: 600px; max-width: 100%; max-height: 100%; border: none; box-shadow: 2px -2px 8px rgba(0,0,0,0.15); z-index: 999999;';
    }
    // Default: bottom-right
    return 'position: fixed; bottom: 0; right: 0; width: 420px; height: 600px; max-width: 100%; max-height: 100%; border: none; box-shadow: -2px -2px 8px rgba(0,0,0,0.15); z-index: 999999;';
  }

  function embedAssistant(config) {
    const targetOrigin = (config && config.origin) || scriptOrigin;
    if (!targetOrigin) {
      console.error(
        '[embed] Cannot resolve assistant origin. Specify { origin: "https://..." } or load from a valid script URL.',
      );
      return;
    }

    activeConfig = Object.assign({}, config, { origin: targetOrigin });
    cleanup();

    iframe = document.createElement('iframe');

    // Construct query parameters if provided
    const queryParams = [];
    if (activeConfig.course) queryParams.push('course=' + encodeURIComponent(activeConfig.course));
    if (activeConfig.lang) queryParams.push('lang=' + encodeURIComponent(activeConfig.lang));
    const qs = queryParams.length > 0 ? '?' + queryParams.join('&') : '';

    iframe.src = targetOrigin + qs;
    iframe.style.cssText = getPlacementStyle(activeConfig.position || 'bottom-right');
    iframe.title = 'Learning assistant';
    iframe.allow =
      activeConfig.allow !== undefined ? activeConfig.allow : 'microphone; display-capture';
    if (activeConfig.sandbox !== undefined) {
      iframe.setAttribute('sandbox', activeConfig.sandbox);
    }

    document.body.appendChild(iframe);

    iframe.onload = function () {
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage(
          { type: 'init', token: activeConfig.token || '' },
          targetOrigin,
        );
      }
    };
  }

  if (typeof window !== 'undefined') {
    window.embedAssistant = embedAssistant;

    // Check declarative data attributes on script tag:
    // e.g. <script src=".../loader.js" data-auto="true" data-course="..." data-lang="am" data-position="bottom-right"></script>
    if (currentScript && currentScript.getAttribute('data-auto') === 'true') {
      const autoCourse = currentScript.getAttribute('data-course') || undefined;
      const autoLang = currentScript.getAttribute('data-lang') || undefined;
      const autoPosition = currentScript.getAttribute('data-position') || 'bottom-right';
      const autoToken = currentScript.getAttribute('data-token') || '';
      embedAssistant({
        origin: scriptOrigin,
        token: autoToken,
        course: autoCourse,
        lang: autoLang,
        position: autoPosition,
      });
    }

    // Keyboard shortcut helper: Alt+Shift+A toggles assistant focus or open
    window.addEventListener('keydown', function (e) {
      if (e.altKey && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
        if (!iframe) {
          embedAssistant(activeConfig);
        } else if (iframe.contentWindow) {
          iframe.contentWindow.focus();
        }
      }
    });
  }
})();
