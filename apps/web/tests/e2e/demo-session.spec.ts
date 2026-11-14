// The synthetic demo sign-in journey in a real browser, using the real
// provisioning and handoff commands against the test database.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const apiDir = fileURLToPath(new URL('../../../api/', import.meta.url));
const demoEnv = {
  ...process.env,
  DEMO_MODE: 'true',
  DEMO_ALLOWED_ORIGINS: 'http://localhost:5173',
};

function runApi(script: string, ...args: string[]): string {
  return execFileSync('node', ['--env-file-if-exists=../../.env', script, ...args], {
    cwd: apiDir,
    env: demoEnv,
    encoding: 'utf8',
  });
}

function newHandoffCode(principal: string): string {
  const code = /^Code: (\S+)$/m.exec(runApi('src/demo-handoff.ts', principal))?.[1];
  if (!code) throw new Error('demo:handoff printed no code');
  return code;
}

test.beforeAll(() => {
  runApi('src/provision-demo.ts');
});

test('a sign-in link works once, then the learner can sign out', async ({ page }) => {
  const code = newHandoffCode('learner-a');
  const signInStatus = page.getByRole('status', { name: 'Sign-in status' });

  await page.goto(`/?handoff=${code}`);

  await expect(signInStatus).toContainText('Signed in as Demo learner A (learner)');
  await expect(signInStatus).toContainText('not real authentication');
  expect(page.url()).not.toContain(code);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    results.violations
      .filter((v) => v.impact === 'critical' || v.impact === 'serious')
      .map((v) => v.id),
  ).toEqual([]);

  // Replaying the same link in a fresh page is refused.
  const replay = await page.context().newPage();
  await replay.goto(`/?handoff=${code}`);
  await expect(replay.getByRole('alert')).toContainText('already used');

  await page.getByRole('button', { name: 'Sign out' }).press('Enter');
  await expect(signInStatus).toContainText('You have signed out');
  await expect(signInStatus).toBeFocused();
});
