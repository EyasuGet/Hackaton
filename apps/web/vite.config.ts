// Dev server proxies /api to the local API so the browser uses one origin.
// Only API_HOST/API_PORT are read here; Vite exposes nothing to client code
// unless it is prefixed with VITE_, so server values stay out of the bundle.
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../..', 'API_');
  // Unlike the API, the dev proxy tolerates a missing .env: it falls back to the
  // .env.example values, and the API itself still rejects missing configuration.
  const apiTarget = `http://${env.API_HOST ?? '127.0.0.1'}:${env.API_PORT ?? '3000'}`;

  return {
    plugins: [react()],
    server: { proxy: { '/api': apiTarget } },
    test: { environment: 'jsdom' },
  };
});
