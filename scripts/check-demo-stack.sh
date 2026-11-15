#!/usr/bin/env bash
# Boots the one-command demo stack (compose.demo.yaml) and checks what a judge
# would hit first (T3-056): seeding succeeds, the API is ready behind the web
# proxy, and the browser code actually compiles. Building images alone is not
# enough: a missing tsconfig only failed when Vite transformed a module.
# Usage: scripts/check-demo-stack.sh   (stops and removes the stack afterwards)
set -euo pipefail

project=track3-demo-check
web=http://127.0.0.1:5173
compose=(docker compose -p "$project" -f compose.demo.yaml)

cleanup() {
  if [ "${failed:-0}" = 1 ]; then "${compose[@]}" logs --no-color --tail 80 || true; fi
  "${compose[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT
fail() {
  failed=1
  echo "FAIL: $1" >&2
  exit 1
}

"${compose[@]}" up -d --build --wait || fail 'stack did not become healthy'

seed=$(docker inspect "$project-seed-1" --format '{{.State.ExitCode}}')
[ "$seed" = 0 ] || fail "seed exited with $seed"

# The Vite dev server can report healthy a moment before it serves pages.
for _ in $(seq 1 30); do
  curl -fsS -o /dev/null "$web/" 2>/dev/null && break
  sleep 2
done

ready=$(curl -fsS "$web/api/ready") || fail 'GET /api/ready through the web proxy failed'
[[ $ready == *'"ready"'* ]] || fail "API not ready: $ready"

# Each module must transform without a Vite error, as a browser would load it.
for module in /src/main.tsx /src/app/app.tsx; do
  body=$(curl -sS -w '\n%{http_code}' "$web$module")
  status=${body##*$'\n'}
  [ "$status" = 200 ] || fail "$module returned HTTP $status"
  if grep -qE 'TSCONFIG_ERROR|Transform failed' <<<"$body"; then fail "$module failed to transform"; fi
done

echo 'Demo stack OK: seeded, API ready, browser modules compile.'
