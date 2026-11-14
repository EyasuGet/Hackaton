# Host fixtures for embed testing

These are distinct-origin host pages used to test the embed loader with postMessage validation.

## Files

- `localhost-5174.html` — Host A, served from localhost:5174
- `127-0-0-1-5174.html` — Host B, served from 127.0.0.1:5174

Both load the embed script and test origin validation by attempting to open the assistant iframe from different origins.

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
