// T3-035 — axe-core gate on every signed-in screen, both locales, desktop and 320 px.
//
// The hackathon gate requires zero critical and zero serious axe violations. Each
// state first waits for the headings or controls it is meant to cover, so a scan of
// a half-loaded page cannot pass by accident. Full results are written under
// test-results/ (uploaded by CI) as evidence for docs/conformance.md.
//
// 200 % zoom is covered by the 320 px states: at 1280 px, 400 % zoom gives a 320 px
// viewport. Telegram and SMS have no web screens, so they are out of scope here.
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';
import { newHandoffCode, runApi } from './demo-api.ts';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const PAGE_ORIGIN = 'http://localhost:5173';

test.beforeAll(() => {
  runApi('src/provision-demo.ts');
  runApi('src/import-content.ts');
  runApi('src/import-jobs.ts');
});

/**
 * Scans the page (or only `include`), writes the full result as evidence and fails
 * on any critical or serious violation. Returns the result for extra assertions.
 */
async function expectNoSeriousViolations(
  page: Page,
  testInfo: TestInfo,
  state: string,
  include?: string,
) {
  const builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  const results = await (include ? builder.include(include) : builder).analyze();
  const path = testInfo.outputPath(`axe-${state}.json`);
  await writeFile(path, JSON.stringify({ state, ...results }, null, 2));
  await testInfo.attach(`axe-${state}.json`, { path, contentType: 'application/json' });
  const blocking = results.violations
    .filter((v) => v.impact === 'critical' || v.impact === 'serious')
    .map((v) => `${v.id} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`);
  expect(blocking, `axe critical/serious violations in state "${state}"`).toEqual([]);
  return results;
}

async function signIn(page: Page, principal: string, width = 1280) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`/#handoff=${newHandoffCode(principal)}`);
  await expect(page.getByRole('status', { name: 'Sign-in status' })).toContainText('Signed in');
}

async function useAmharic(page: Page) {
  await page.getByRole('button', { name: 'አማርኛ' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'am');
}

/** Exchanges a demo sign-in code for a bearer token, as the page does. */
async function apiToken(request: APIRequestContext, principal: string): Promise<string> {
  const response = await request.post('/api/demo/session', {
    headers: { Origin: PAGE_ORIGIN },
    data: { code: newHandoffCode(principal) },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { token: string }).token;
}

// Headings that prove each role's panels have rendered before scanning. The employer
// portal is rendered for every signed-in role (#233), so it is waited for too.
const PANELS = {
  'learner-a': [
    'Your course material',
    'Request human help',
    'Your help requests',
    'Request interview accommodation',
    'Employer Recruitment Portal',
  ],
  support: ['Your help requests', 'Accommodation Coordinator Inbox', 'Employer Recruitment Portal'],
  teacher: ['Frequently asked topics', 'Employer Recruitment Portal'],
};

for (const [principal, headings] of Object.entries(PANELS)) {
  for (const width of [1280, 320]) {
    for (const locale of ['en', 'am'] as const) {
      test(`${principal} screens in ${locale} at ${width}px have no serious violations`, async ({
        page,
      }, testInfo) => {
        await signIn(page, principal, width);
        for (const name of headings) {
          await expect(page.getByRole('heading', { name })).toBeVisible();
        }
        if (locale === 'am') await useAmharic(page);
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

// The interaction states run in English at desktop width; their Amharic and 320 px
// layouts are the same components already scanned above.
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

  // Human-help preview, then the sent request in the inbox.
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

test('reply threads, screen sharing and the coordinator inbox have no serious violations', async ({
  page,
  request,
}, testInfo) => {
  // Synthetic records: a help request claimed and answered by support, and an
  // accommodation request for an approved job, so the threaded states render.
  const learner = { Authorization: `Bearer ${await apiToken(request, 'learner-a')}` };
  const support = { Authorization: `Bearer ${await apiToken(request, 'support')}` };
  const created = await request.post('/api/help/requests', {
    headers: learner,
    data: { clientRequestId: randomUUID(), contextSnapshot: 'Synthetic: stuck on planning.' },
  });
  expect(created.ok()).toBe(true);
  const helpId = ((await created.json()) as { request: { id: string } }).request.id;
  const claimed = await request.post(`/api/help/requests/${helpId}/claim`, { headers: support });
  expect(claimed.ok()).toBe(true);
  const supportReply = await request.post(`/api/help/requests/${helpId}/replies`, {
    headers: support,
    data: { clientReplyId: randomUUID(), body: 'Synthetic support reply.' },
  });
  expect(supportReply.ok()).toBe(true);
  const jobsResponse = await request.get('/api/jobs', { headers: learner });
  const [job] = ((await jobsResponse.json()) as { jobs: { id: string }[] }).jobs;
  expect(job, 'an approved active job exists').toBeDefined();
  const accommodation = await request.post('/api/accommodation/requests', {
    headers: learner,
    data: {
      clientRequestId: randomUUID(),
      jobId: job?.id,
      supportDescription: 'Synthetic: extra time.',
    },
  });
  expect(accommodation.ok()).toBe(true);

  // Learner: claimed request with its reply thread and screen-share controls.
  await signIn(page, 'learner-a');
  await expect(page.getByText('Synthetic support reply.').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /share screen/i }).first()).toBeVisible();
  await expectNoSeriousViolations(page, testInfo, 'learner-claimed-thread-share-en-1280');
  await page.setViewportSize({ width: 320, height: 900 });
  await useAmharic(page);
  await expectNoSeriousViolations(page, testInfo, 'learner-claimed-thread-share-am-320');

  // Support: coordinator inbox showing the pending request.
  await signIn(page, 'support');
  await expect(page.getByText('Synthetic: extra time.').first()).toBeVisible();
  await expectNoSeriousViolations(page, testInfo, 'coordinator-request-en-1280');
  await page.setViewportSize({ width: 320, height: 900 });
  await useAmharic(page);
  await expectNoSeriousViolations(page, testInfo, 'coordinator-request-am-320');
});

// No demo principal has the employer role, so publishing is refused (403) and the
// portal shows its error; that is the state every demo user can reach (#233).
test('employer portal after a refused publish has no serious violations', async ({
  page,
}, testInfo) => {
  await signIn(page, 'learner-a');
  await page.getByLabel(/role title \*/i).fill('Synthetic data clerk');
  await page.getByLabel(/description \*/i).fill('Synthetic vacancy for accessibility checks.');
  await page.getByRole('button', { name: /publish vacancy/i }).click();
  await expect(page.locator('.alert-error[role="alert"]')).toBeVisible();
  await expectNoSeriousViolations(page, testInfo, 'employer-publish-refused');
});

test('assistant embedded in the Savanna host has no serious violations', async ({
  page,
}, testInfo) => {
  await page.goto('http://localhost:5174/savanna-concept.html');
  const code = newHandoffCode('learner-a');
  await page.evaluate(({ origin, token }) => window.embedAssistant({ origin, token }), {
    origin: PAGE_ORIGIN,
    token: code,
  });
  const frame = page.frameLocator('iframe[title="Learning assistant"]');
  await expect(frame.getByRole('status', { name: 'Sign-in status' })).toContainText('Signed in');
  // Only the assistant is ours; the organiser's host page is out of scope.
  const results = await expectNoSeriousViolations(
    page,
    testInfo,
    'embedded-savanna',
    'iframe[title="Learning assistant"]',
  );
  expect(results.passes.length, 'the scan reached inside the iframe').toBeGreaterThan(10);
});
