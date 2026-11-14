// Browser tests run against the real API (which reads the root
// .env or CI environment) and the Vite dev server that proxies /api to it.
import { defineConfig, devices } from '@playwright/test';

const apiPort = process.env.API_PORT ?? '3000';

export default defineConfig({
  testDir: 'tests/e2e',
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? 'list' : 'line',
  use: { baseURL: 'http://localhost:5173' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // Plain node, not the watch-mode dev script: `--watch` tries to watch the
      // optional .env file and crashes where it does not exist, such as CI.
      command: 'node --env-file-if-exists=../../.env src/server.ts',
      cwd: '../api',
      url: `http://127.0.0.1:${apiPort}/api/health`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'pnpm --filter @track3/web dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
