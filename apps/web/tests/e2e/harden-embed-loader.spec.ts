import { expect, test } from '@playwright/test';

test.describe('Harden Embed Loader for Third-Party Sites (T3-045)', () => {
  const fixtureHost = 'http://localhost:5174';

  test('declarative data attributes automatically mount assistant iframe', async ({ page }) => {
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

    const iframe = page.locator('iframe[title="Learning assistant"]');
    await expect(iframe).toBeVisible({ timeout: 5000 });

    const style = await iframe.getAttribute('style');
    expect(style).toContain('left: 0');
    expect(style).toContain('bottom: 0');

    const src = await iframe.getAttribute('src');
    expect(src).toContain('course=course-1');
    expect(src).toContain('lang=am');
  });

  test('embedAssistant fails closed without valid origin', async ({ page }) => {
    await page.goto(`${fixtureHost}/localhost-5174.html`);

    const result = await page.evaluate(() => {
      let loggedError = '';
      const originalError = console.error;
      console.error = (...args) => {
        loggedError = args.join(' ');
        originalError(...args);
      };

      try {
        // Explicitly clear origin
        window.embedAssistant({ origin: '' });
      } finally {
        console.error = originalError;
      }
      return loggedError;
    });

    expect(result).toContain('Cannot resolve assistant origin');
  });
});
