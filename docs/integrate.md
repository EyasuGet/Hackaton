# Third-Party Integration Guide (T3-045, T3-051)

Embed the Digital Bridge Accessible Assistant into any LMS, job board, or training portal in under 60 seconds.

---

## 1. Quick Start: One-line `<script>` Tag

Place the script loader tag at the bottom of your HTML `<body>`:

```html
<script
  src="https://assistant.digitalbridge.et/loader.js"
  data-auto="true"
  data-course="course-1"
  data-lang="am"
  data-position="bottom-right"
  defer
></script>
```

### Data Attribute Configuration

| Attribute | Type | Default | Description |
|---|---|---|---|
| `data-auto` | boolean (`"true"\|"false"`) | `"false"` | If `"true"`, mounts the iframe widget immediately on load. |
| `data-course` | string | `""` | The active course context (e.g. `course-1`). |
| `data-lang` | string (`"en"\|"am"`) | `"en"` | Initial interface language (`en` for English, `am` for Amharic). |
| `data-position` | string (`"bottom-right"\|"bottom-left"\|"inline"`) | `"bottom-right"` | Docking location (`bottom-right`, `bottom-left`), or `"inline"` inside a page container. |
| `data-container` | string (CSS selector) | `""` | Host selector when `data-position="inline"` (e.g. `"#assistant-mount"`). |
| `data-token` | string | `""` | Optional initial learner session or demo handoff token. |

---

## 2. Programmatic JavaScript API

If your host application manages single-page application (SPA) state or handles user authentication dynamically, use `window.embedAssistant(config)`:

```html
<script src="https://assistant.digitalbridge.et/loader.js"></script>

<script>
  // Open assistant on button click
  document.getElementById('help-btn').addEventListener('click', () => {
    window.embedAssistant({
      origin: 'https://assistant.digitalbridge.et',
      token: userSessionToken,
      course: 'course-1',
      lang: 'am',
      position: 'bottom-right', // Or 'inline' with container: '#help-container'
      allow: 'microphone; display-capture'
    });
  });

  // Minimize or maximize programmatically
  window.minimiseAssistant();
  window.maximiseAssistant();
</script>
```

---

## 3. Host Security & Content Security Policy (CSP)

To embed the assistant in your platform, your Content Security Policy must permit the frame and microphone/screen sharing permissions:

### CSP Directives
```http
Content-Security-Policy:
  frame-src 'self' https://assistant.digitalbridge.et;
  script-src 'self' https://assistant.digitalbridge.et;
```

### Feature Policy / Permissions Policy
```http
Permissions-Policy: microphone=(self "https://assistant.digitalbridge.et"), display-capture=(self "https://assistant.digitalbridge.et")
```

---

## 4. Keyboard Accessibility & WCAG 2.4.11 Compliance

- **Focus Not Obscured (WCAG 2.4.11 AA)**: When in overlay mode (`bottom-right` or `bottom-left`), the loader automatically collapses the assistant to a compact launcher button if host page keyboard focus moves to an element positioned beneath the panel.
- **Manual Minimise**: The assistant panel footer includes a prominent "Minimise" button returning focus to the host page launcher.
- **Toggle Shortcut**: `Alt + Shift + A` toggles or maximizes the assistant from anywhere on the host page.
- **Escape Key**: Pressing `Esc` inside the assistant drawer minimizes it and returns focus back to the triggering host element.
- **Screen Reader Support**: The iframe announces itself with `title="Learning assistant"` and contains a polite live region for status changes.
