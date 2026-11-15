import { expect, test } from '@playwright/test';

test.describe('Harden Embed Loader for Third-Party Sites (T3-045)', () => {
  test('declarative data attributes automatically mount assistant iframe', async ({ page }) => {
    // Navigate to a blank HTML page that embeds loader with data attributes
    await page.setContent(`
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <title>Third-Party LMS Host Page</title>
        </head>
        <body>
          <h1>External Platform Course View</h1>
          <script
            src="/loader.js"
            data-auto="true"
            data-course="course-1"
            data-lang="am"
            data-position="bottom-left"
          ></script>
        </body>
      </html>
    `);

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

  test('embedAssistant fails closed without origin or script context', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <body>
          <script src="/loader.js"></script>
          <script>
            // Calling without origin or token when currentScript is not available
            window.embedAssistant({ origin: '' });
          </script>
        </body>
      </html>
    `);

    // Should fail closed with console error
    expect(consoleErrors.some((err) => err.includes('Cannot resolve assistant origin'))).toBe(true);
    // Should NOT mount iframe
    const iframe = page.locator('iframe[title="Learning assistant"]');
    expect(await iframe.count()).toBe(0);
  });
});
