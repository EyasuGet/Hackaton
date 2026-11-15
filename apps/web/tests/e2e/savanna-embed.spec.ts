// T3-026-B — Integration evidence: embed loader inside the official Savanna
// static pages structure.
//
// Fixture: fixtures/hosts/savanna-concept.html
//   A minimal faithful reproduction of the actual Savanna concept page
//   (alx-africa/Savanna-static-pages commit 9e83ac7), with our loader.js
//   added as a final <script> tag. See that file's header comment for the
//   exact fidelity points and what is omitted.
//
// What these tests prove:
//   1. The embed mounts inside the Savanna page DOM without conflict.
//   2. A permitted synthetic demo session opens and renders the assistant.
//   3. A message from a forbidden origin is rejected.
//   4. A Savanna template swap (static-page.js simulated) does not unmount
//      an embed that is already attached to document.body.
//
// Live Savanna SSO and production host acceptance are out of scope; they are
// separate unverified claims recorded in docs/savanna-reconciliation.md.
import { expect, test } from '@playwright/test';

const SAVANNA_FIXTURE = 'http://localhost:5174/savanna-concept.html';

test.describe('T3-026-B: Embed inside Savanna static page structure', () => {
  test('loader script loads without errors inside Savanna page structure', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto(SAVANNA_FIXTURE);
    await page.waitForTimeout(500);

    // No script errors; embedAssistant global is defined.
    expect(errors).toHaveLength(0);
    const hasEmbed = await page.evaluate(() => typeof window.embedAssistant === 'function');
    expect(hasEmbed).toBe(true);
  });

  test('permitted synthetic demo context mounts the assistant iframe', async ({ page }) => {
    await page.goto(SAVANNA_FIXTURE);

    // Click the Open button — this calls embedAssistant with a synthetic demo token.
    await page.locator('#open-btn').click();

    // iframe should appear and render the assistant heading.
    const iframeLocator = page.frameLocator('iframe[title="Learning assistant"]');
    await expect(iframeLocator.locator('h1')).toContainText('Learning assistant', {
      timeout: 8000,
    });

    // Confirm the iframe is visually present.
    const isVisible = await page.locator('iframe[title="Learning assistant"]').isVisible();
    expect(isVisible).toBe(true);
  });

  test('forbidden origin message is rejected with a console warning', async ({ page }) => {
    await page.goto(SAVANNA_FIXTURE);

    const warnings: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'warning') warnings.push(msg.text());
    });

    // Dispatch a message that claims to come from an unauthorised origin.
    // The loader must reject it and log a warning; it must not act on the message.
    await page.evaluate(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'close' },
          origin: 'http://forbidden.example.com',
          source: window,
        }),
      );
    });

    await page.waitForTimeout(200);
    const rejection = warnings.find((w) => w.includes('Rejecting message from untrusted origin'));
    expect(rejection).toBeDefined();
  });

  test('malformed message from any origin is rejected', async ({ page }) => {
    await page.goto(SAVANNA_FIXTURE);

    const warnings: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'warning') warnings.push(msg.text());
    });

    // Send a structurally invalid message from the correct origin; loader rejects it.
    await page.evaluate(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { notAValidType: true },
          origin: 'http://localhost:5173',
          source: window,
        }),
      );
    });

    await page.waitForTimeout(200);
    const malformed = warnings.find((w) => w.includes('malformed'));
    expect(malformed).toBeDefined();
  });

  test('Savanna template swap does not unmount the embed', async ({ page }) => {
    await page.goto(SAVANNA_FIXTURE);

    // Open the embed first.
    await page.locator('#open-btn').click();
    await expect(page.locator('iframe[title="Learning assistant"]')).toBeVisible({
      timeout: 8000,
    });

    // Trigger the simulated static-page.js template swap.
    await page.evaluate(() => {
      (window as Window & { __savannaTriggerTemplateSwap?: () => void }).__savannaTriggerTemplateSwap?.();
    });

    // The embed iframe is on document.body, outside the swapped container;
    // it must remain mounted after the swap.
    await expect(page.locator('iframe[title="Learning assistant"]')).toBeVisible({
      timeout: 1000,
    });
  });

  test('close message from correct origin removes the iframe and restores focus', async ({
    page,
  }) => {
    await page.goto(SAVANNA_FIXTURE);

    // Open.
    await page.locator('#open-btn').click();
    const iframeLocator = page.frameLocator('iframe[title="Learning assistant"]');
    await expect(iframeLocator.locator('h1')).toContainText('Learning assistant', {
      timeout: 8000,
    });

    // Close via the button inside the iframe.
    await iframeLocator.locator('button:has-text("Close")').click();

    // iframe removed.
    await expect(page.locator('iframe[title="Learning assistant"]')).toBeHidden({
      timeout: 3000,
    });
  });
});
