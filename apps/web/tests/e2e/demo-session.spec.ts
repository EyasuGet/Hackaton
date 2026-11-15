// The synthetic demo sign-in journey in a real browser, using the real
// provisioning and handoff commands against the test database.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { newHandoffCode, runApi } from './demo-api.ts';

// Note: this re-provisions the demo principals in the configured database, so
// demo tokens printed earlier by `pnpm demo:provision` stop working.
test.beforeAll(() => {
  runApi('src/provision-demo.ts');
});

test('a sign-in link works once, then the learner can sign out', async ({ page }) => {
  const code = newHandoffCode('learner-a');
  const signInStatus = page.getByRole('status', { name: 'Sign-in status' });

  await page.goto(`/#handoff=${code}`);

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
  await replay.goto(`/#handoff=${code}`);
  await expect(replay.getByRole('alert')).toContainText('already used');

  await page.getByRole('button', { name: 'Sign out' }).press('Enter');
  await expect(signInStatus).toContainText('You have signed out');
  await expect(signInStatus).toBeFocused();
});

test('a session expiring mid-form loses no typed text', async ({ page }) => {
  await page.clock.install();
  await page.goto(`/#handoff=${newHandoffCode('learner-a')}`);
  const signInStatus = page.getByRole('status', { name: 'Sign-in status' });
  const sessionAlert = page.getByRole('region', { name: 'Demo sign-in' }).getByRole('alert');
  await expect(signInStatus).toContainText('Signed in as Demo learner A');

  await page.getByLabel('Your question').fill('Synthetic unsent question');
  await page.getByRole('button', { name: 'Request help' }).click();
  await page.getByLabel('Your context (what you want to share)').fill('Synthetic help draft');

  // Warned before expiry, with time to act; extending keeps the session.
  await page.clock.fastForward('01:55:30');
  await expect(sessionAlert).toContainText('ends in less than 5 minutes');
  await page.getByRole('button', { name: 'Stay signed in' }).click();
  await expect(sessionAlert).toHaveCount(0);

  // Ignoring the next warning lets the session expire; the forms close.
  await page.clock.fastForward('02:00:00');
  await expect(signInStatus).toContainText('Your session has ended');
  await expect(page.getByLabel('Your context (what you want to share)')).toHaveCount(0);

  // Signing in again on this device brings every typed word back.
  const next = await page.context().newPage();
  await next.goto(`/#handoff=${newHandoffCode('learner-a')}`);
  await expect(next.getByLabel('Your question')).toHaveValue('Synthetic unsent question');
  await next.getByRole('button', { name: 'Request help' }).click();
  await expect(next.getByLabel('Your context (what you want to share)')).toHaveValue(
    'Synthetic help draft',
  );
  await expect(next.getByText('Draft saved on this device only.').first()).toBeVisible();
});
