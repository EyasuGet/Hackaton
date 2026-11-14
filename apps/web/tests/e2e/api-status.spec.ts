// End-to-end check of the real web → proxy → API path, plus automated
// accessibility scans of each rendered status. axe assists, but does not replace,
// the manual NVDA/TalkBack and co-designer checks.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function seriousAccessibilityViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations
    .filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')
    .map((violation) => `${violation.id}: ${violation.help}`);
}

test('reports the running API as available, with no serious accessibility violations', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page.getByRole('status', { name: 'Service status' })).toHaveText('API available');
  expect(await seriousAccessibilityViolations(page)).toEqual([]);
});

test('the unavailable state has no serious accessibility violations', async ({ page }) => {
  // Only the browser-level rendering is under test here; the unit tests cover the
  // status logic, so the failing response is simulated at the network boundary.
  await page.route('**/api/health', (route) => route.fulfill({ status: 503 }));
  await page.goto('/');

  await expect(page.getByRole('status', { name: 'Service status' })).toHaveText('API unavailable');
  expect(await seriousAccessibilityViolations(page)).toEqual([]);
});
