# Embedding the learning assistant and host permissions

## Overview

The assistant is embedded into a host page via a small script loader that:
1. Creates an isolated iframe on the assistant origin
2. Validates `postMessage` origin, schema, and audience
3. Manages lifecycle (open, close, teardown) with focus restoration
4. Keeps credentials server-controlled and out of DOM attributes

This design supports both synthetic demo sessions and a future real-host identity adapter.

## Script loader

The loader is built separately from the main app and served at `/loader.js`.

### Loading the script

Add a `<script>` tag to the host HTML page:

```html
<script src="https://your-assistant-deployment/loader.js"></script>
<script>
  embedAssistant({
    token: 'demo-token-or-handoff-code',
    origin: 'https://your-assistant-deployment',
  });
</script>
```

### Configuration

```typescript
interface EmbedConfig {
  readonly token: string;     // Bearer token for authentication (server-issued)
  readonly origin: string;    // Assistant origin (validated exactly in postMessage)
}
```

## Origin validation

The loader validates `postMessage` source and origin:

- **Exact match:** `event.origin === config.origin`
- **Never trusts:** `null`, `file://`, or mismatched origins
- **Rejects forged:** Messages claiming a different origin are logged and dropped

This prevents credential/session leakage to unintended recipients.

## Lifecycle and focus

### Open

Call `embedAssistant(config)` to create the iframe and send an init message with the token.

```javascript
embedAssistant({
  token: sessionToken,
  origin: 'http://localhost:5173',
});
```

### Close

Inside the iframe, click a close button or call:

```javascript
window.parent.postMessage({ type: 'close' }, expectedOrigin);
```

The loader:
1. Removes the iframe
2. Restores focus to the previously focused element or `document.body`

### Teardown

If loaded twice on the same page, the loader cleans up the previous iframe and listeners before creating a new one (idempotent).

## Host permissions and CSP

### Content Security Policy (CSP)

The host page should allow:

```
frame-ancestors 'self' https://your-assistant-deployment;
script-src 'self' https://your-assistant-deployment;
```

### Iframe sandboxing

The iframe uses these permissions:

```html
<iframe sandbox="allow-same-origin allow-scripts allow-forms allow-popups" ...></iframe>
```

If microphone input is needed (voice features), also allow:

```
allow-microphone allow-display-capture
```

### Microphone delegation

The host page must delegate microphone access to the iframe:

```html
<iframe ... allow="microphone; display-capture"></iframe>
```

When a user activates voice input in the iframe, the browser prompts for microphone access on the host page, and the permission is inherited by the iframe.

## Token handling

- Tokens are **server-issued** and **short-lived**.
- Tokens are **never** stored in:
  - DOM attributes
  - Browser local storage (per host)
  - Logs or analytics
  - URLs (except during the handoff)
- Tokens are passed via `postMessage` init, not in the iframe `src`.

## Message protocol

### Init (host → iframe)

```json
{ "type": "init", "token": "..." }
```

Sent when iframe loads; provides the bearer token.

### Ready (iframe → host)

```json
{ "type": "status", "status": "ready" }
```

Iframe signals it has initialized and is ready to receive messages.

### Close (iframe → host)

```json
{ "type": "close" }
```

User clicked close or the iframe is shutting down.

### Status (iframe → host)

```json
{ "type": "status", "status": "closed" }
```

Iframe confirms it is closing.

## Demo vs. production

### Demo (synthetic identities)

The development environment uses server-controlled demo identities:
- Token issued by `/api/demo/handoff` after a one-time code verification
- Role and course grants are fixed in the database
- Visible label: "Demo mode — synthetic identities, not real authentication"

### Production (Savanna SSO)

A future real-host adapter will:
- Exchange Savanna credentials for an assistant session token
- Validate institution/learner/course context on each request
- Implement a separate contract (T3-004-B: Savanna SSO integration)

This is **not** the current implementation. Demo credentials are not production credentials.

## Testing

Two fixture hosts verify cross-origin embed behavior:

- `localhost:5174` — Host A
- `127.0.0.1:5174` — Host B (distinct origin)

Run browser tests:

```bash
# Start dev server
pnpm dev

# In another terminal, run browser tests
pnpm test:e2e tests/e2e/embed.spec.ts
```

Tests verify:
- Origin validation (reject forged origins)
- Lifecycle (open, close, teardown)
- Focus restoration
- Listener cleanup (idempotent reload)
- Accessibility (keyboard navigation in iframe)

## Future adapter seam

The message protocol is intentionally minimal to support a future real-host adapter:

1. Host page loads the loader script from the assistant domain.
2. Loader creates iframe and validates origin.
3. Init message passes a server-issued token (demo or real).
4. Iframe runs the assistant with that token.

A real-host adapter follows the same pattern:
- Host page exchanges Savanna credentials for a token via a separate handoff endpoint.
- Token is passed to `embedAssistant()`.
- Loader and iframe logic unchanged; only the token source and validation logic in the API changes.

No new postMessage negotiation or protocol versioning is needed; the interface remains stable.

## Troubleshooting

### "Rejecting message from untrusted origin"

Verify the origin matches exactly:
- Host page origin: `http://localhost:5174`
- Config origin: `http://localhost:5173`
- Are they the same?

### Iframe does not appear

1. Check browser console for errors (e.g., CORS, missing `#root` element).
2. Verify the assistant origin is accessible from the host page.
3. Check that the iframe `src` matches the configured origin.

### Focus not restored

If the focused element was removed from the DOM, focus falls back to `document.body`. Ensure the close button or trigger element still exists when closing.

### Token not being sent

Verify the token is passed in the config and that the iframe origin is whitelisted to receive it.

## References

- [postMessage validation](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage)
- [CSP frame-ancestors](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/frame-ancestors)
- [Iframe sandbox attribute](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe#sandbox)
