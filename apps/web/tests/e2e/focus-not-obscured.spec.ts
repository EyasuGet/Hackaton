// E2E test verifying WCAG 2.4.11 (Focus Not Obscured - Minimum) for embedded assistant (T3-051).
import { expect, test } from '@playwright/test';

test.describe('WCAG 2.4.11: Focus Not Obscured for Embedded Assistant', () => {
  const fixtureHost = 'http://localhost:5174';

  test('collapses / minimises automatically when keyboard focus lands on a host element behind the panel', async ({
    page,
  }) => {
    await page.goto(`${fixtureHost}/localhost-5174.html`);

    // Inject an interactive button positioned directly in the bottom-right corner behind the fixed panel
    await page.evaluate(() => {
      const behindBtn = document.createElement('button');
      behindBtn.id = 'bottom-corner-btn';
      behindBtn.textContent = 'Bottom Corner Action';
      behindBtn.style.cssText = `
        position: fixed;
        bottom: 50px;
        right: 50px;
        z-index: 10;
        padding: 10px 20px;
      `;
      document.body.appendChild(behindBtn);
    });

    // Open embedded assistant in default bottom-right position
    const openBtn = page.locator('#open-btn');
    await openBtn.click();

    const iframe = page.locator('iframe[title="Learning assistant"]');
    await expect(iframe).toBeVisible({ timeout: 5000 });

    // Focus the button that is located in the bottom right corner
    await page.locator('#bottom-corner-btn').focus();

    // Verify the assistant panel auto-minimised to prevent obscuring focused host element
    await expect(iframe).toBeHidden({ timeout: 3000 });

    // The launcher button should now be visible to allow reopening
    const launcher = page.locator('.digitalbridge-assistant-launcher');
    await expect(launcher).toBeVisible({ timeout: 2000 });

    // Verify elementFromPoint on focused button: it must not be obscured by the iframe
    const isObscured = await page.evaluate(() => {
      const btn = document.getElementById('bottom-corner-btn');
      if (!btn) return true;
      const rect = btn.getBoundingClientRect();
      const topElem = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
      // Top element must be the button itself or a descendant, not an overlay iframe
      return topElem !== btn && !btn.contains(topElem);
    });

    expect(isObscured).toBe(false);
  });

  test('user can manually minimise panel using iframe control and restore launcher', async ({
    page,
  }) => {
    await page.goto(`${fixtureHost}/localhost-5174.html`);

    await page.locator('#open-btn').click();
    const iframe = page.locator('iframe[title="Learning assistant"]');
    await expect(iframe).toBeVisible({ timeout: 5000 });

    // Click Minimise inside iframe
    const minimiseBtn = page
      .frameLocator('iframe[title="Learning assistant"]')
      .locator('button:has-text("Minimise")');
    await minimiseBtn.click();

    // Panel is hidden and launcher is visible
    await expect(iframe).toBeHidden({ timeout: 2000 });
    const launcher = page.locator('.digitalbridge-assistant-launcher');
    await expect(launcher).toBeVisible();

    // Clicking launcher re-opens the assistant
    await launcher.click();
    await expect(iframe).toBeVisible({ timeout: 2000 });
  });

  test('inline placement renders assistant inside host container with zero fixed-overlay obscuring', async ({
    page,
  }) => {
    await page.goto(`${fixtureHost}/localhost-5174.html`);

    // Add inline container and mount with data-position="inline"
    await page.evaluate(() => {
      window.embedAssistant({
        origin: 'http://localhost:5173',
        position: 'inline',
        container: '#mount',
      });
    });

    const iframe = page.locator('#mount iframe[title="Learning assistant"]');
    await expect(iframe).toBeVisible({ timeout: 5000 });

    // In inline mode, style is relative to container, not fixed overlay
    const style = await iframe.getAttribute('style');
    expect(style).not.toContain('position: fixed');
    expect(style).toContain('width: 100%');
  });
});
