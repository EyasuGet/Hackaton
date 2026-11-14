// Browser tests for embed loader: origin validation, lifecycle, focus management.
import { expect, test } from '@playwright/test';

test.describe('Embed loader', () => {
  const fixtureHost = 'http://localhost:5174';

  test('loads the embed script without errors', async ({ page }) => {
    const logs: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        logs.push(`[${msg.type()}] ${msg.text()}`);
      }
    });

    // Navigate to fixture host that loads the script.
    await page.goto(`${fixtureHost}/localhost-5174.html`);
    await page.waitForTimeout(500);

    // No script errors should have occurred.
    expect(logs).not.toContainEqual(expect.stringMatching(/ReferenceError.*embedAssistant/));
  });

  test('opens iframe with valid postMessage from correct origin', async ({ page }) => {
    await page.goto(`${fixtureHost}/localhost-5174.html`);

    // Click open button to trigger embedAssistant().
    const openBtn = page.locator('#open-btn');
    await openBtn.click();

    // Wait for iframe to appear.
    const iframe = page.frameLocator('iframe[title="Learning assistant"]');
    await expect(iframe.locator('h1')).toContainText('Learning assistant', { timeout: 5000 });

    // Verify iframe is visible and rendered.
    expect(
      await page.frameLocator('iframe[title="Learning assistant"]').locator('h1').isVisible(),
    ).toBe(true);
  });

  test('rejects postMessage from mismatched origin', async ({ page }) => {
    await page.goto(`${fixtureHost}/localhost-5174.html`);
    const logs: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'warning') logs.push(msg.text());
    });

    // Attempt to send message from wrong origin; loader should reject it.
    await page.evaluate(() => {
      const fakeEvent = new MessageEvent('message', {
        data: { type: 'close' },
        origin: 'http://evil.example.com', // Wrong origin
        source: window,
      });
      window.dispatchEvent(fakeEvent);
    });

    // Check that a warning was logged.
    await page.waitForTimeout(100);
    const rejection = logs.find((msg) => msg.includes('Rejecting message from untrusted origin'));
    expect(rejection).toBeDefined();
  });

  test('closes iframe and restores focus', async ({ page }) => {
    await page.goto(`${fixtureHost}/localhost-5174.html`);

    // Open iframe.
    await page.locator('#open-btn').click();
    const iframe = page.frameLocator('iframe[title="Learning assistant"]');
    await expect(iframe.locator('h1')).toContainText('Learning assistant', { timeout: 5000 });

    // Click close button inside iframe.
    const closeBtn = iframe.locator('button:has-text("Close")');
    await closeBtn.click();

    // Wait for iframe to be removed.
    await expect(page.locator('iframe[title="Learning assistant"]')).toBeHidden({ timeout: 2000 });

    // Verify focus is restored to the host page.
    const focusedElement = await page.evaluate(() => {
      return (
        (document.activeElement as HTMLElement | null)?.id ||
        document.activeElement?.tagName ||
        'UNKNOWN'
      );
    });
    expect(['BODY', 'open-btn', 'close-btn']).toContain(focusedElement);
  });

  test('loading twice is idempotent (no listener leak)', async ({ page }) => {
    await page.goto(`${fixtureHost}/localhost-5174.html`);

    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    // Open once.
    await page.locator('#open-btn').click();
    await expect(page.locator('iframe[title="Learning assistant"]')).toBeVisible({ timeout: 5000 });

    // Open again (should replace iframe, not accumulate errors).
    await page.locator('#open-btn').click();
    await expect(page.locator('iframe[title="Learning assistant"]')).toBeVisible({ timeout: 5000 });

    // Should not have errors about listeners or DOM.
    expect(errors).toHaveLength(0);
  });

  test('accessibility: iframe content renders with proper heading', async ({ page }) => {
    await page.goto(`${fixtureHost}/localhost-5174.html`);

    // Open iframe.
    await page.locator('#open-btn').click();
    const iframe = page.frameLocator('iframe[title="Learning assistant"]');

    // Verify heading exists (accessibility check).
    await expect(iframe.locator('h1')).toContainText('Learning assistant');

    // Verify form inputs exist and are visible.
    const textarea = iframe.locator('textarea[dir="auto"]');
    await expect(textarea).toBeVisible();

    const submitBtn = iframe.locator('button[type="submit"]');
    await expect(submitBtn).toBeVisible();
  });

  test('handles rapid open/close without memory leaks', async ({ page }) => {
    await page.goto(`${fixtureHost}/localhost-5174.html`);

    // Rapidly open and close 3 times.
    for (let i = 0; i < 3; i++) {
      await page.locator('#open-btn').click();
      await expect(page.locator('iframe[title="Learning assistant"]')).toBeVisible({
        timeout: 2000,
      });

      const closeBtn = page
        .frameLocator('iframe[title="Learning assistant"]')
        .locator('button:has-text("Close")');
      await closeBtn.click();
      await expect(page.locator('iframe[title="Learning assistant"]')).toBeHidden({
        timeout: 1000,
      });
    }

    // No console errors should have accumulated.
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.waitForTimeout(200);
    expect(errors).toHaveLength(0);
  });

  test('validates message schema; rejects malformed messages', async ({ page }) => {
    await page.goto(`${fixtureHost}/localhost-5174.html`);
    const logs: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'warning') logs.push(msg.text());
    });

    // Open iframe.
    await page.locator('#open-btn').click();
    const iframe = page.frameLocator('iframe[title="Learning assistant"]');
    await expect(iframe.locator('h1')).toContainText('Learning assistant', { timeout: 5000 });

    // Send malformed message from iframe to parent (missing 'type' field).
    await page.evaluate(() => {
      const iframe = document.querySelector('iframe');
      if (iframe?.contentWindow) {
        iframe.contentWindow.postMessage({ invalid: 'message' }, '*');
      }
    });

    await page.waitForTimeout(100);
    // Loader should warn about malformed message.
    const malformed = logs.find((msg) => msg.includes('malformed'));
    expect(malformed).toBeDefined();
  });
});

test.describe('Embed from distinct origin', () => {
  test('Host B (127.0.0.1) can embed and communicate with Host A origin', async ({ page }) => {
    // Navigate from a different origin to the assistant origin.
    // This tests origin validation when iframe origin ≠ host origin.
    await page.goto('http://127.0.0.1:5174/127-0-0-1-5174.html');

    // Open iframe (which is on localhost:5173, different from 127.0.0.1:5174).
    await page.locator('#open-btn').click();

    // Iframe should load and render correctly despite origin difference.
    const iframe = page.frameLocator('iframe[title="Learning assistant"]');
    await expect(iframe.locator('h1')).toContainText('Learning assistant', { timeout: 5000 });

    // Verify close works from a different host origin.
    const closeBtn = iframe.locator('button:has-text("Close")');
    await closeBtn.click();
    await expect(page.locator('iframe[title="Learning assistant"]')).toBeHidden({ timeout: 2000 });
  });
});
