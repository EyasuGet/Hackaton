#!/bin/sh
set -e

echo "==> [Render Entrypoint] Starting Track 3 Assistant on Render..."

# 1. Run database migrations
echo "==> [Render Entrypoint] Applying database migrations..."
node apps/api/dist/migrate.js || {
  echo "WARN: Migration failed or database not ready yet. Retrying in 3s..."
  sleep 3
  node apps/api/dist/migrate.js
}

# 2. Seed content and jobs
echo "==> [Render Entrypoint] Importing course content and jobs..."
node apps/api/src/import-content.ts || true
node apps/api/src/import-jobs.ts || true

# 3. Seed demo accounts if DEMO_MODE=true
if [ "$DEMO_MODE" = "true" ]; then
  echo "==> [Render Entrypoint] DEMO_MODE=true: Provisioning demo credentials..."
  node apps/api/dist/provision-demo.js || true
fi

# 3. Launch Fastify API in background on 127.0.0.1:3000
echo "==> [Render Entrypoint] Starting Fastify API on 127.0.0.1:3000..."
API_HOST=127.0.0.1 API_PORT=3000 node apps/api/dist/server.js &
API_PID=$!

# Wait for local API to report health
echo "==> [Render Entrypoint] Waiting for API health check..."
for i in $(seq 1 30); do
  if wget -q -O - http://127.0.0.1:3000/api/health | grep -q '"status":"ok"'; then
    echo "==> [Render Entrypoint] Fastify API is healthy."
    break
  fi
  sleep 1
done

# Trap SIGTERM to cleanly shut down both processes
cleanup() {
  echo "==> [Render Entrypoint] Shutting down..."
  kill -TERM "$API_PID" 2>/dev/null || true
  exit 0
}
trap cleanup TERM INT

# 4. Start Caddy in foreground on Render's assigned $PORT (default 10000)
echo "==> [Render Entrypoint] Launching Caddy on port ${PORT:-10000}..."
caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
