// Browser tests run against the real API (which reads the root
// .env or CI environment) and the Vite dev server that proxies /api to it.
import { defineConfig, devices } from '@playwright/test';

const apiPort = process.env.API_PORT ?? '3000';
const pageOrigin = 'http://localhost:5173';

// The browser tests sign in with synthetic demo sessions, so this test-only API
// runs in demo mode and accepts the Vite page's origin.
const apiEnv = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  ),
  DEMO_MODE: 'true',
  DEMO_ALLOWED_ORIGINS: pageOrigin,
};

export default defineConfig({
  testDir: 'tests/e2e',
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? 'list' : 'line',
  use: { baseURL: pageOrigin },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // Plain node, not the watch-mode dev script: `--watch` tries to watch the
      // optional .env file and crashes where it does not exist, such as CI.
      command: 'node --env-file-if-exists=../../.env src/server.ts',
      cwd: '../api',
      env: apiEnv,
      url: `http://127.0.0.1:${apiPort}/api/health`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'pnpm --filter @track3/web dev',
      url: pageOrigin,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'python3 -m http.server 5174 --directory ../../fixtures/hosts',
      url: 'http://127.0.0.1:5174/localhost-5174.html',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
