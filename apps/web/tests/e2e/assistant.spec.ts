// Browser checks for the conversation shell: real keyboard use, each labelled
// fixture state scanned with axe, and reflow at narrow widths. axe assists, but
// does not replace, the manual NVDA/TalkBack and co-designer checks.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function seriousAccessibilityViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations
    .filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')
    .map((violation) => `${violation.id}: ${violation.help}`);
}

async function ask(page: Page, scenario: string, question: string) {
  await page.getByLabel('Demo reply scenario').selectOption(scenario);
  await page.getByLabel('Your question').fill(question);
  await page.getByLabel('Your question').press('Enter');
}

test('a keyboard user can ask and hear the reply without losing focus', async ({ page }) => {
  await page.goto('/');

  // Tab order: the two language buttons, the scenario selector, then the question box.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'English' })).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Demo reply scenario')).toBeFocused();
  await page.keyboard.press('Tab');
  const question = page.getByLabel('Your question');
  await expect(question).toBeFocused();

  await page.keyboard.type('What is photosynthesis?');
  await page.keyboard.press('Enter');

  await expect(page.getByRole('listitem').last()).toContainText('not a tutor answer');
  await expect(question).toBeFocused();
  await expect(question).toHaveValue('');
  await expect(page.getByRole('status', { name: 'Conversation updates' })).toContainText(
    'Assistant: This is a demo reply',
  );
});

// Replies also appear in the hidden announcement region, so answer text is
// looked up inside the visible message list.
const STATES = [
  { scenario: 'amharic', shows: 'ይህ የሙከራ መልስ ነው።', inMessages: true },
  { scenario: 'mixed', shows: 'مرحبا بكم', inMessages: true },
  { scenario: 'denied', shows: 'session has expired', inMessages: false },
  { scenario: 'failed', shows: 'could not be sent', inMessages: false },
  { scenario: 'slow', shows: 'Waiting for a reply…', inMessages: false },
];

for (const { scenario, shows, inMessages } of STATES) {
  test(`the ${scenario} state is readable and has no serious accessibility violations`, async ({
    page,
  }) => {
    await page.goto('/');
    await ask(page, scenario, 'Question for the fixture');

    const scope = inMessages ? page.getByRole('list') : page.locator('main');
    await expect(scope.getByText(shows, { exact: false })).toBeVisible();
    expect(await seriousAccessibilityViolations(page)).toEqual([]);
  });
}

test('the Amharic interface is chosen by keyboard and has no serious accessibility violations', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Your question').fill('ያልተላከ ጥያቄ');

  await page.getByRole('button', { name: 'አማርኛ' }).focus();
  await page.keyboard.press('Enter');

  await expect(page.locator('html')).toHaveAttribute('lang', 'am');
  await expect(page).toHaveTitle('የትምህርት ረዳት');
  await expect(page.getByLabel('ጥያቄዎ')).toHaveValue('ያልተላከ ጥያቄ');
  await page.getByLabel('ጥያቄዎ').press('Enter');
  await expect(page.getByRole('list')).toContainText('ረዳት (ሙከራ)');
  expect(await seriousAccessibilityViolations(page)).toEqual([]);
});

test('right-to-left text resolves to RTL in the reply and the question box', async ({ page }) => {
  await page.goto('/');
  await ask(page, 'mixed', 'Question');

  const reply = page.getByRole('list').getByText('مرحبا بكم', { exact: false });
  await expect(reply).toBeVisible();
  expect(await reply.evaluate((element) => element.matches(':dir(rtl)'))).toBe(true);

  const question = page.getByLabel('Your question');
  await question.fill('ما هو التمثيل الضوئي؟');
  expect(await question.evaluate((element) => element.matches(':dir(rtl)'))).toBe(true);
});

test('reply markup is shown as text and never executed', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  await page.goto('/');
  await ask(page, 'markup', 'Question');

  await expect(
    page.getByRole('list').getByText('<script>alert(2)</script>', { exact: false }),
  ).toBeVisible();
  await expect(page.locator('main img, main script')).toHaveCount(0);
  expect(dialogs).toEqual([]);
  expect(await seriousAccessibilityViolations(page)).toEqual([]);
});

test('the conversation reflows without horizontal scrolling at 320 CSS pixels', async ({
  page,
}) => {
  // 320 px wide is the WCAG 1.4.10 reflow width (1280 px at 400% zoom).
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  await ask(page, 'mixed', 'A long question that needs to wrap onto several lines here');

  await expect(page.getByRole('listitem')).toHaveCount(2);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
