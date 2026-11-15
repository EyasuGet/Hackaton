# Host fixtures for embed testing

These are distinct-origin host pages used to test the embed loader with postMessage validation.

## Files

- `localhost-5174.html` — Host A, served from localhost:5174
- `127-0-0-1-5174.html` — Host B, served from 127.0.0.1:5174
- `savanna-concept.html` — Savanna static page structure fixture (T3-026-B)

The first two files test origin validation from different host origins. The Savanna fixture is a minimal faithful reproduction of the structural elements of the official Savanna static pages (alx-africa/Savanna-static-pages commit 9e83ac7) with our loader.js added as a final script tag. See `docs/evidence/t3-026-b-savanna-embed.md` for the full fidelity record and evidence.

All load the embed script and verify origin validation, embed lifecycle, and mount stability.

## Manual test

```bash
# Start the dev server first
pnpm dev  # runs on localhost:5173

# In another terminal, serve fixtures from two origins:
cd fixtures/hosts
python3 -m http.server 5174 --bind localhost &
python3 -m http.server 5175 --bind 127.0.0.1 &

# Open in browser:
# http://localhost:5174/localhost-5174.html
# http://127.0.0.1:5175/127-0-0-1-5174.html

# Verify:
# - Assistant iframe appears
# - Typing a message works
# - Close button removes iframe and returns focus
# - No console errors about rejected origins
```
