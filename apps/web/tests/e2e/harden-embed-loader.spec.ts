import { expect, test } from '@playwright/test';

test.describe('Harden Embed Loader for Third-Party Sites (T3-045)', () => {
  const fixtureHost = 'http://localhost:5174';

  test('declarative data attributes automatically mount assistant iframe', async ({ page }) => {
    // Navigate to fixture host and dynamically inject script with data attributes
    await page.goto(`${fixtureHost}/localhost-5174.html`);

    await page.evaluate(() => {
      const script = document.createElement('script');
      script.src = 'http://localhost:5173/loader.js';
      script.setAttribute('data-auto', 'true');
      script.setAttribute('data-course', 'course-1');
      script.setAttribute('data-lang', 'am');
      script.setAttribute('data-position', 'bottom-left');
      document.body.appendChild(script);
    });

    // Verify iframe was created automatically
    const iframe = page.locator('iframe[title="Learning assistant"]');
    await expect(iframe).toBeVisible({ timeout: 5000 });

    // Verify position style
    const style = await iframe.getAttribute('style');
    expect(style).toContain('left: 0');
    expect(style).toContain('bottom: 0');

    // Verify src has query params
    const src = await iframe.getAttribute('src');
    expect(src).toContain('course=course-1');
    expect(src).toContain('lang=am');
  });

  test('embedAssistant fails closed with console.error when origin is invalid', async ({
    page,
  }) => {
    await page.goto(`${fixtureHost}/localhost-5174.html`);

    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.evaluate(() => {
      // Calling with explicitly empty origin
      window.embedAssistant({ origin: '' });
    });

    // Should fail closed with console error
    expect(consoleErrors.some((err) => err.includes('Cannot resolve assistant origin'))).toBe(true);
  });
});
