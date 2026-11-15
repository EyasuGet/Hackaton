// Standalone script loader for embedding the assistant iframe into a host page (T3-045, T3-051).
// Validates origin/schema, supports data attributes & declarative setup, manages lifecycle.
// WCAG 2.4.11 (Focus Not Obscured): supports minimizing, auto-minimizing on host focus, and inline container placement.
/* global window, document, console, URL */
(function () {
  let iframe = null;
  let launcherBtn = null;
  let previousFocusedElement = null;
  let isMinimised = false;
  let autoMinimiseEnabled = true;

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
      launcherBtn.style.cssText = [
        'position: fixed',
        'bottom: 16px',
        isLeft ? 'left: 16px' : 'right: 16px',
        'padding: 10px 16px',
        'background-color: #0369a1',
        'color: #ffffff',
        'border: 2px solid #ffffff',
        'border-radius: 24px',
        'box-shadow: 0 4px 12px rgba(0,0,0,0.25)',
        'font-family: system-ui, sans-serif',
        'font-size: 14px',
        'font-weight: 600',
        'cursor: pointer',
        'z-index: 999999',
      ].join('; ');

      launcherBtn.onclick = function () {
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
      case 'minimize':
        return true;
      case 'status':
        return (
          'status' in data &&
          (data.status === 'ready' || data.status === 'closed' || data.status === 'minimized')
        );
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

    if (event.data.type === 'minimize') {
      minimiseAssistant();
    }

    if (event.data.type === 'open') {
      maximiseAssistant();
    }

    if (event.data.type === 'close') {
      previousFocusedElement = document.activeElement || null;
      cleanup();
      restoreFocus();
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('message', function (event) {
      onMessage(event, activeConfig);
    });
  }

  function getPlacementStyle(position) {
    if (position === 'inline') {
      return 'width: 100%; height: 600px; border: none; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);';
    }
    if (position === 'bottom-left') {
      return 'position: fixed; bottom: 0; left: 0; width: 420px; height: 600px; max-width: 100%; max-height: 100%; border: none; box-shadow: 2px -2px 8px rgba(0,0,0,0.15); z-index: 999999;';
    }
    // Default: bottom-right
    return 'position: fixed; bottom: 0; right: 0; width: 420px; height: 600px; max-width: 100%; max-height: 100%; border: none; box-shadow: -2px -2px 8px rgba(0,0,0,0.15); z-index: 999999;';
  }

  function checkFocusObscured(focusedElement) {
    if (!iframe || isMinimised || !focusedElement || activeConfig.position === 'inline') return;
    if (focusedElement === iframe || focusedElement === launcherBtn) return;

    const iframeRect = iframe.getBoundingClientRect();
    const elemRect = focusedElement.getBoundingClientRect();

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

    if (activeConfig.position === 'inline' && activeConfig.container) {
      const targetContainer =
        typeof activeConfig.container === 'string'
          ? document.querySelector(activeConfig.container)
          : activeConfig.container;
      if (targetContainer) {
        targetContainer.appendChild(iframe);
      } else {
        document.body.appendChild(iframe);
      }
    } else {
      document.body.appendChild(iframe);
    }

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
    window.minimiseAssistant = minimiseAssistant;
    window.maximiseAssistant = maximiseAssistant;
    window.setAutoMinimise = function (enabled) {
      autoMinimiseEnabled = enabled;
    };

    // Declarative data attributes
    if (currentScript && currentScript.getAttribute('data-auto') === 'true') {
      const autoCourse = currentScript.getAttribute('data-course') || undefined;
      const autoLang = currentScript.getAttribute('data-lang') || undefined;
      const autoPosition = currentScript.getAttribute('data-position') || 'bottom-right';
      const autoContainer = currentScript.getAttribute('data-container') || undefined;
      const autoToken = currentScript.getAttribute('data-token') || '';
      embedAssistant({
        origin: scriptOrigin,
        token: autoToken,
        course: autoCourse,
        lang: autoLang,
        position: autoPosition,
        container: autoContainer,
      });
    }

    // Keyboard shortcut helper: Alt+Shift+A toggles assistant focus or open
    window.addEventListener('keydown', function (e) {
      if (e.altKey && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
        if (!iframe || isMinimised) {
          maximiseAssistant();
        } else if (iframe.contentWindow) {
          iframe.contentWindow.focus();
        }
      }
    });

    // Host focus tracking for WCAG 2.4.11 (Focus Not Obscured)
    window.addEventListener('focusin', function () {
      const active = document.activeElement;
      checkFocusObscured(active);
    });
  }
})();
