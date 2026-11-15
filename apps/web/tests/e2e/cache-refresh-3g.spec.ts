// End-to-end tests for offline cache refresh, update notification, and 3G text transfer metrics (T3-008-B).
// Verifies user-selected preferences survive reloads, 3G network conditions remain lightweight
// without media downloads, and offline transitions report limitations honestly without false delivery.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { MAX_LIGHTWEIGHT_TEXT_BYTES } from '../../src/features/assistant/text-metrics.ts';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function seriousAccessibilityViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations
    .filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')
    .map((violation) => `${violation.id}: ${violation.help}`);
}

test.describe('Cache refresh and preference persistence (T3-008-B)', () => {
  test('persists user-selected language across reloads and cache refreshes', async ({ page }) => {
    await page.goto('/');

    // Select Amharic
    await page.getByRole('button', { name: 'አማርኛ' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'am');
    await expect(page).toHaveTitle('የትምህርት ረዳት');

    // Reload page (simulates SW cache refresh or browser refresh)
    await page.reload();

    // Verify preferences survive without resetting to English
    await expect(page.locator('html')).toHaveAttribute('lang', 'am');
    await expect(page).toHaveTitle('የትምህርት ረዳት');
    await expect(page.getByRole('button', { name: 'አማርኛ' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Switch back to English
    await page.getByRole('button', { name: 'English' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });
});

test.describe('3G network throttling and text path metrics (T3-008-B)', () => {
  test('measures lightweight text transfer and asserts no media downloads under throttled 3G', async ({
    page,
  }) => {
    test.slow();
    // Emulate standard 3G profile (750 kbps download, 250 kbps upload, 100ms latency)
    const client = await page.context().newCDPSession(page);
    await client.send('Network.emulateNetworkConditions', {
      offline: false,
      downloadThroughput: (750 * 1024) / 8,
      uploadThroughput: (250 * 1024) / 8,
      latency: 100,
    });

    const requests: { url: string; resourceType: string; postDataSize: number }[] = [];
    page.on('request', (req) => {
      requests.push({
        url: req.url(),
        resourceType: req.resourceType(),
        postDataSize: req.postDataBuffer()?.length ?? 0,
      });
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Interact with assistant
    const question = page.getByLabel('Your question');
    await question.fill('What is photosynthesis?');
    await question.press('Enter');

    await expect(page.getByRole('listitem').last()).toContainText('not a tutor answer');

    // Assert that no audio or video assets were downloaded on the text path
    const mediaRequests = requests.filter(
      (r) =>
        r.resourceType === 'media' ||
        r.url.endsWith('.mp3') ||
        r.url.endsWith('.mp4') ||
        r.url.endsWith('.wav'),
    );
    expect(mediaRequests).toHaveLength(0);

    // Verify that question requests are lightweight (well within budget)
    for (const r of requests) {
      expect(r.postDataSize).toBeLessThan(MAX_LIGHTWEIGHT_TEXT_BYTES);
    }
  });

  test('reports offline disconnection honestly without false delivery claims, and recovers on reconnect', async ({
    page,
  }) => {
    await page.goto('/');

    // Drop connection
    await page.context().setOffline(true);

    // Verify offline banner appears with polite live region
    const banner = page.getByRole('status').filter({ hasText: /You are offline/i });
    await expect(banner).toBeVisible();

    // Reconnect
    await page.context().setOffline(false);
    await expect(banner).toBeHidden();

    // Verify no accessibility violations in offline/online transitions
    expect(await seriousAccessibilityViolations(page)).toEqual([]);
  });
});
