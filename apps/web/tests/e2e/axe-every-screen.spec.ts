// T3-035 — axe-core gate on every signed-in screen, both locales, desktop and 320 px.
//
// The hackathon gate requires zero critical and zero serious axe violations. Each
// state first waits for the panels it is meant to cover, so a scan of a half-loaded
// page cannot pass by accident. Full results are attached to the Playwright report
// as evidence for the conformance report (docs/conformance.md).
import { writeFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { newHandoffCode, runApi } from './demo-api.ts';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test.beforeAll(() => {
  runApi('src/provision-demo.ts');
  runApi('src/import-content.ts');
  runApi('src/import-jobs.ts');
});

/** Scans the page, attaches the full result and fails on any critical or serious violation. */
async function expectNoSeriousViolations(page: Page, testInfo: TestInfo, state: string) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  // Written under test-results/, which CI uploads as the axe evidence artefact.
  const path = testInfo.outputPath(`axe-${state}.json`);
  await writeFile(path, JSON.stringify({ state, ...results }, null, 2));
  await testInfo.attach(`axe-${state}.json`, { path, contentType: 'application/json' });
  const blocking = results.violations
    .filter((v) => v.impact === 'critical' || v.impact === 'serious')
    .map((v) => `${v.id} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`);
  expect(blocking, `axe critical/serious violations in state "${state}"`).toEqual([]);
}

async function signIn(page: Page, principal: string) {
  await page.goto(`/#handoff=${newHandoffCode(principal)}`);
  await expect(page.getByRole('status', { name: 'Sign-in status' })).toContainText('Signed in');
}

// Headings that prove each role's panels have rendered before scanning.
const PANELS: Record<string, string[]> = {
  'learner-a': [
    'Your course material',
    'Request human help',
    'Your help requests',
    'Request interview accommodation',
  ],
  support: ['Accommodation Coordinator Inbox'],
  teacher: ['Frequently asked topics'],
};

for (const principal of Object.keys(PANELS)) {
  for (const width of [1280, 320]) {
    for (const locale of ['en', 'am'] as const) {
      test(`${principal} screens in ${locale} at ${width}px have no serious violations`, async ({
        page,
      }, testInfo) => {
        await page.setViewportSize({ width, height: 900 });
        await signIn(page, principal);
        for (const name of PANELS[principal]!) {
          await expect(page.getByRole('heading', { name })).toBeVisible();
        }
        if (locale === 'am') {
          await page.getByRole('button', { name: 'አማርኛ' }).click();
          await expect(page.locator('html')).toHaveAttribute('lang', 'am');
        }
        await expectNoSeriousViolations(page, testInfo, `${principal}-${locale}-${width}`);
      });
    }
  }
}

test('signed-out demo page has no serious violations', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByLabel('Demo reply scenario')).toBeVisible();
  await expectNoSeriousViolations(page, testInfo, 'signed-out');
});

test('learner states after acting have no serious violations', async ({ page }, testInfo) => {
  await signIn(page, 'learner-a');

  // Simple-language mode and a cited answer.
  await page.getByLabel('Use simple, direct language').check();
  const question = page.getByLabel('Your question');
  await question.fill('What is a virtual assistant?');
  await question.press('Enter');
  const answer = page.locator('.messages .message-assistant').first();
  await expect(answer.locator('.citations')).toBeVisible({ timeout: 10000 });
  await expectNoSeriousViolations(page, testInfo, 'answer-simple-mode');

  // Human-help preview, then the sent request in the inbox with its sharing controls.
  await page
    .getByRole('button', { name: /request help/i })
    .first()
    .click();
  await page.getByLabel(/your context/i).fill('I am stuck on the planning lesson.');
  await page
    .getByRole('button', { name: /review before sending/i })
    .first()
    .click();
  await expect(page.getByRole('region', { name: /what will be shared/i })).toBeVisible();
  await expectNoSeriousViolations(page, testInfo, 'help-preview');
  await page
    .getByRole('button', { name: /confirm and send/i })
    .first()
    .click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: /waiting/i })
      .first(),
  ).toBeVisible();
  await expectNoSeriousViolations(page, testInfo, 'help-sent-inbox');

  // Accommodation composer (a learner who already has requests sees "Submit another").
  await page.getByRole('button', { name: /start a request|submit another request/i }).click();
  await expect(page.getByLabel(/job/i).first()).toBeVisible();
  await expectNoSeriousViolations(page, testInfo, 'accommodation-composer');

  // Offline banner.
  await page.context().setOffline(true);
  await expect(page.getByText('You are offline')).toBeVisible();
  await expectNoSeriousViolations(page, testInfo, 'offline');
  await page.context().setOffline(false);
});

test('assistant embedded in the Savanna host has no serious violations', async ({
  page,
}, testInfo) => {
  await page.goto('http://localhost:5174/savanna-concept.html');
  const code = newHandoffCode('learner-a');
  await page.evaluate(({ origin, token }) => window.embedAssistant({ origin, token }), {
    origin: 'http://localhost:5173',
    token: code,
  });
  const frame = page.frameLocator('iframe[title="Learning assistant"]');
  await expect(frame.getByRole('status', { name: 'Sign-in status' })).toContainText('Signed in');
  // Only the assistant is ours; the organiser's host page is out of scope.
  const results = await new AxeBuilder({ page })
    .include('iframe[title="Learning assistant"]')
    .withTags(WCAG_TAGS)
    .analyze();
  const path = testInfo.outputPath('axe-embedded-savanna.json');
  await writeFile(path, JSON.stringify({ state: 'embedded-savanna', ...results }, null, 2));
  await testInfo.attach('axe-embedded-savanna.json', { path, contentType: 'application/json' });
  expect(results.passes.length, 'the scan reached inside the iframe').toBeGreaterThan(10);
  expect(
    results.violations
      .filter((v) => v.impact === 'critical' || v.impact === 'serious')
      .map((v) => v.id),
  ).toEqual([]);
});
