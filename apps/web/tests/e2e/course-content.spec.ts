// Course-material search and citation reading in a real browser (T3-005-B):
// a signed-in learner opens a cited section, and cannot find content from a
// course they are not granted.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { newHandoffCode, runApi } from './demo-api.ts';

test.beforeAll(() => {
  // Re-provisions demo principals and imports the approved fixtures (idempotent).
  runApi('src/provision-demo.ts');
  runApi('src/import-content.ts');
});

test('a learner finds and reads a cited section, but not another course’s content', async ({
  page,
}) => {
  await page.goto(`/#handoff=${newHandoffCode('learner-a')}`);
  await expect(page.getByRole('status', { name: 'Sign-in status' })).toContainText(
    'Demo learner A',
  );

  const search = page.getByLabel('Search your course material');
  await search.fill('How is AI changing virtual assistant work?');
  await search.press('Enter');
  const result = page.getByRole('button', {
    name: 'Artificial Intelligence and the Future of VA Work',
  });
  await result.click();

  const heading = page.getByRole('heading', {
    level: 3,
    name: 'Artificial Intelligence and the Future of VA Work',
  });
  await expect(heading).toBeFocused();
  await expect(
    page.getByText(/Approved lesson from https:\/\/github.com\/alx-africa\/Savanna-static-pages/),
  ).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    results.violations
      .filter((v) => v.impact === 'critical' || v.impact === 'serious')
      .map((v) => v.id),
  ).toEqual([]);

  await page.getByRole('button', { name: 'Back to results' }).click();
  await expect(result).toBeFocused();

  // Learner A has no course-2 grant, so the Amharic demo lesson is never found.
  await search.fill('እቅድ');
  await search.press('Enter');
  await expect(page.getByRole('status', { name: 'Search status' })).toHaveText(
    'No matching course material found.',
  );
});
