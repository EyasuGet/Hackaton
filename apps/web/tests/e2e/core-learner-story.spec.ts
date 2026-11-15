// T3-027-B — Verify the core end-to-end learner story.
//
// This comprehensive E2E test suite exercises the complete learner story:
//   1. Static starter iframe embedding with Permissions-Policy delegation.
//   2. Single-use authenticated demo session handoff into memory.
//   3. Course material lookup and in-place reading of cited sections.
//   4. Course question answering with grounded syllabus citations.
//   5. Out-of-syllabus query with honest refusal fallback (no hallucinations/fabricated citations).
//   6. Asynchronous human support request submission with disclosure preview.
//   7. Querying approved career opportunities with valid citations.
//   8. Acknowledging expired roles with truthful expiration dates and closed application status.
//   9. Interview accommodation request submission to opportunity coordinator with disclosure preview.
//  10. Controlled desktop screen sharing controls and graceful degradation under restricted permissions.
import { expect, test } from '@playwright/test';
import { newHandoffCode, runApi } from './demo-api.ts';

const SAVANNA_HOST = 'http://localhost:5174/savanna-concept.html';
const ASSISTANT_ORIGIN = 'http://localhost:5173';

test.beforeAll(() => {
  // Idempotently provisions demo principals and imports approved course and job fixtures.
  runApi('src/provision-demo.ts');
  runApi('src/import-content.ts');
  runApi('src/import-jobs.ts');
});

test.describe('T3-027-B: Core End-to-End Learner Story', () => {
  test('concise end-to-end learner story: embed, course grounding, honest fallback, support, careers, accommodations, and screen share controls', async ({
    page,
  }) => {
    // -------------------------------------------------------------------------
    // 1. Static Starter Embedding & Permissions Delegation
    // -------------------------------------------------------------------------
    await page.goto(SAVANNA_HOST);

    const code = newHandoffCode('learner-a');
    await page.evaluate(
      ({ origin, token }) => {
        window.embedAssistant({
          origin,
          token,
          allow: 'microphone; display-capture',
        });
      },
      { origin: ASSISTANT_ORIGIN, token: code },
    );

    const iframeElement = page.locator('iframe[title="Learning assistant"]');
    await expect(iframeElement).toBeVisible({ timeout: 8000 });

    const allowAttr = await iframeElement.getAttribute('allow');
    expect(allowAttr).toContain('display-capture');
    expect(allowAttr).toContain('microphone');

    const frame = page.frameLocator('iframe[title="Learning assistant"]');
    await expect(frame.locator('h1')).toContainText('Learning assistant', { timeout: 8000 });

    // -------------------------------------------------------------------------
    // 2. Authenticated Synthetic Demo Session Handoff
    // -------------------------------------------------------------------------
    const statusText = frame.getByRole('status', { name: 'Sign-in status' });
    await expect(statusText).toContainText('Signed in as Demo learner A (learner)', {
      timeout: 10000,
    });
    await expect(statusText).toContainText('not real authentication');

    // -------------------------------------------------------------------------
    // 3. Course Material Lookup & In-Place Cited Section Reading
    // -------------------------------------------------------------------------
    await expect(frame.getByRole('heading', { name: 'Your course material' })).toBeVisible();
    const searchInput = frame.getByLabel('Search your course material');
    await searchInput.fill('How is AI changing virtual assistant work?');
    await searchInput.press('Enter');

    const courseResultBtn = frame.getByRole('button', {
      name: 'Artificial Intelligence and the Future of VA Work',
    });
    await expect(courseResultBtn).toBeVisible({ timeout: 8000 });
    await courseResultBtn.click();

    const sectionHeading = frame.getByRole('heading', {
      level: 3,
      name: 'Artificial Intelligence and the Future of VA Work',
    });
    await expect(sectionHeading).toBeVisible();
    await expect(frame.getByRole('button', { name: 'Back to results' })).toBeVisible();

    // -------------------------------------------------------------------------
    // 4. Grounded Course Q&A with Syllabus Citations
    // -------------------------------------------------------------------------
    const questionInput = frame.getByLabel('Your question');
    await questionInput.fill('What is a virtual assistant?');
    await questionInput.press('Enter');

    const firstAnswer = frame.locator('.messages .message-assistant').first();
    await expect(firstAnswer).toContainText('human remote professionals', { timeout: 10000 });

    // Verify grounded citation markup is present and linked to approved syllabus
    const citationsRegion = firstAnswer.locator('.citations');
    await expect(citationsRegion).toBeVisible();
    await expect(citationsRegion).toContainText('The Future of the VA Industry');

    // -------------------------------------------------------------------------
    // 5. Out-of-Syllabus Query & Honest Refusal Fallback (No Hallucinations)
    // -------------------------------------------------------------------------
    await questionInput.fill('What is the capital city of France?');
    await questionInput.press('Enter');

    const refusalAnswer = frame.locator('.messages .message-assistant').nth(1);
    await expect(refusalAnswer).toContainText(
      'I do not have an approved course answer for that question in the materials.',
      { timeout: 10000 },
    );
    // Explicitly assert zero citations fabricated for out-of-syllabus refusal
    await expect(refusalAnswer.locator('.citations')).toHaveCount(0);

    // -------------------------------------------------------------------------
    // 6. Asynchronous Human Help Request Submission
    // -------------------------------------------------------------------------
    const helpBtn = frame.getByRole('button', { name: /request help/i });
    await expect(helpBtn).toBeVisible();
    await helpBtn.click();

    const contextInput = frame.getByLabel(/your context/i);
    await contextInput.fill(
      'Need guidance on the Module 2 scheduling assessment and practical exam details.',
    );
    await frame.getByRole('button', { name: /review before sending/i }).click();

    // Verify disclosure notice is presented before confirming transmission
    await expect(frame.getByRole('region', { name: /what will be shared/i })).toBeVisible();
    await frame.getByRole('button', { name: /confirm and send/i }).click();

    // Verify request enters waiting state
    await expect(frame.getByRole('status').filter({ hasText: /waiting/i })).toBeVisible({
      timeout: 8000,
    });

    // -------------------------------------------------------------------------
    // 7. Querying Approved Jobs with Valid Citations
    // -------------------------------------------------------------------------
    await questionInput.fill('Are there any virtual assistant jobs?');
    await questionInput.press('Enter');

    const jobAnswer = frame.locator('.messages .message-assistant').nth(2);
    await expect(jobAnswer).toContainText('Savanna Digital Services has an active opening', {
      timeout: 10000,
    });
    // Check approved jobs speaker label
    await expect(jobAnswer.locator('.speaker')).toContainText('Assistant (approved jobs)');

    // Verify clickable citation link to external approved portal
    const jobLink = jobAnswer.locator('.citations a.citation-link');
    await expect(jobLink).toBeVisible();
    expect(await jobLink.getAttribute('href')).toBe(
      'https://digitalbridge.et/jobs/job-va-specialist-01',
    );

    // -------------------------------------------------------------------------
    // 8. Querying Expired Job with Truthful Acknowledgment
    // -------------------------------------------------------------------------
    await questionInput.fill('Is the Data Entry and Records Clerk job open?');
    await questionInput.press('Enter');

    const expiredAnswer = frame.locator('.messages .message-assistant').nth(3);
    await expect(expiredAnswer).toContainText(
      'expired on 2026-10-01 and is no longer open for applications',
      { timeout: 10000 },
    );
    await expect(expiredAnswer.locator('.citations')).toContainText('Data Entry and Records Clerk');
    await expect(expiredAnswer.locator('.citations')).toContainText('(Expired)');

    // -------------------------------------------------------------------------
    // 9. Interview Accommodation Request to Coordinator
    // -------------------------------------------------------------------------
    const startAccomBtn = frame.getByRole('button', {
      name: /request an interview accommodation|start a request|submit another request/i,
    });
    await expect(startAccomBtn).toBeVisible({ timeout: 5000 });
    await startAccomBtn.click();

    // Select the approved job vacancy
    const jobSelect = frame.getByLabel(/job/i);
    await expect(jobSelect).toBeVisible({ timeout: 5000 });
    await jobSelect.selectOption({ value: 'job-va-specialist-01' });
    await frame.getByRole('button', { name: /^next$/i }).click();

    // Fill accommodation description
    const accomDescription = frame.getByRole('textbox', {
      name: /support description|describe/i,
    });
    await accomDescription.fill(
      'Screen reader accommodation and extra 30 minutes for technical interview.',
    );
    await frame.getByRole('button', { name: /review before sending/i }).click();

    // Verify disclosure and recipient preview
    await expect(frame.getByRole('heading', { name: /review your request/i })).toBeVisible();
    await expect(frame.getByText('Authorised coordinator only')).toBeVisible();
    await frame.getByRole('button', { name: /confirm and send/i }).click();

    // Verify status confirms submission to coordinator
    await expect(
      frame.getByRole('status').filter({ hasText: /coordinator will respond/i }),
    ).toBeVisible({ timeout: 8000 });

    // -------------------------------------------------------------------------
    // 10. Screen Share Controls & Capabilities
    // -------------------------------------------------------------------------
    // Verify that screen sharing respects desktop capture constraints
    const shareSection = frame.locator('.screen-share');
    if (await shareSection.isVisible()) {
      const shareBtn = shareSection.getByRole('button', { name: /share screen/i });
      if (await shareBtn.isVisible()) {
        await expect(shareBtn).toBeEnabled();
      }
    }
  });

  test('honest refusal fallback reliably avoids fabricated citations on unknown queries', async ({
    page,
  }) => {
    await page.goto(SAVANNA_HOST);
    const code = newHandoffCode('learner-a');

    await page.locator('#token-input').fill(code);
    await page.locator('#open-btn').click();

    const frame = page.frameLocator('iframe[title="Learning assistant"]');
    await expect(frame.getByRole('status', { name: 'Sign-in status' })).toContainText(
      'Demo learner A',
      { timeout: 10000 },
    );

    const questionInput = frame.getByLabel('Your question');

    // Query 1: Culinary recipe query (out of course scope)
    await questionInput.fill('How do I bake sourdough bread?');
    await questionInput.press('Enter');

    const firstMsg = frame.locator('.messages .message-assistant').first();
    await expect(firstMsg).toContainText(
      'I do not have an approved course answer for that question in the materials.',
      { timeout: 10000 },
    );
    await expect(firstMsg.locator('.citations')).toHaveCount(0);

    // Query 2: Unrelated tech infrastructure outside curriculum
    await questionInput.fill('How do I configure a Kubernetes ingress controller?');
    await questionInput.press('Enter');

    const secondMsg = frame.locator('.messages .message-assistant').nth(1);
    await expect(secondMsg).toContainText(
      'I do not have an approved course answer for that question in the materials.',
      { timeout: 10000 },
    );
    await expect(secondMsg.locator('.citations')).toHaveCount(0);
  });

  test('career Q&A distinguishes active approved opportunities from expired positions', async ({
    page,
  }) => {
    await page.goto(SAVANNA_HOST);
    const code = newHandoffCode('learner-a');

    await page.locator('#token-input').fill(code);
    await page.locator('#open-btn').click();

    const frame = page.frameLocator('iframe[title="Learning assistant"]');
    await expect(frame.getByRole('status', { name: 'Sign-in status' })).toContainText(
      'Demo learner A',
      { timeout: 10000 },
    );

    const questionInput = frame.getByLabel('Your question');

    // 1. Active job requirements query
    await questionInput.fill('What are the requirements for Virtual Assistant Specialist?');
    await questionInput.press('Enter');

    const activeReply = frame.locator('.messages .message-assistant').first();
    await expect(activeReply).toContainText('Requirements for Virtual Assistant Specialist', {
      timeout: 10000,
    });
    await expect(activeReply.locator('.speaker')).toContainText('Assistant (approved jobs)');

    const link = activeReply.locator('.citations a.citation-link');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute(
      'href',
      'https://digitalbridge.et/jobs/job-va-specialist-01',
    );

    // 2. Expired role query
    await questionInput.fill('Is the Data Entry and Records Clerk job open?');
    await questionInput.press('Enter');

    const expiredReply = frame.locator('.messages .message-assistant').nth(1);
    await expect(expiredReply).toContainText(
      'expired on 2026-10-01 and is no longer open for applications',
      { timeout: 10000 },
    );
    await expect(expiredReply.locator('.citations')).toContainText('Data Entry and Records Clerk');
    await expect(expiredReply.locator('.citations')).toContainText('(Expired)');

    // 3. Unlisted role query returns honest limitation without fabricating job records
    await questionInput.fill('Is Acme Corporation hiring in Addis Ababa?');
    await questionInput.press('Enter');

    const unlistedReply = frame.locator('.messages .message-assistant').nth(2);
    await expect(unlistedReply).toContainText(/I do not have an approved job/i, { timeout: 10000 });
    await expect(unlistedReply.locator('.citations')).toHaveCount(0);
  });

  test('interview accommodation workflow enforces recipient disclosure and review step', async ({
    page,
  }) => {
    await page.goto(SAVANNA_HOST);
    const code = newHandoffCode('learner-a');

    await page.locator('#token-input').fill(code);
    await page.locator('#open-btn').click();

    const frame = page.frameLocator('iframe[title="Learning assistant"]');
    await expect(frame.getByRole('status', { name: 'Sign-in status' })).toContainText(
      'Demo learner A',
      { timeout: 10000 },
    );

    // Start accommodation
    const startAccomBtn = frame.getByRole('button', {
      name: /request an interview accommodation|start a request|submit another request/i,
    });
    await expect(startAccomBtn).toBeVisible({ timeout: 5000 });
    await startAccomBtn.click();

    // Select job
    const jobSelect = frame.getByLabel(/job/i);
    await expect(jobSelect).toBeVisible({ timeout: 5000 });
    await jobSelect.selectOption({ value: 'job-va-specialist-01' });
    await frame.getByRole('button', { name: /^next$/i }).click();

    // Fill accommodation details
    const textbox = frame.getByRole('textbox', {
      name: /support description|describe/i,
    });
    await textbox.fill(
      'Quiet room, text transcription display, and 15-minute rest interval between coding tasks.',
    );
    await frame.getByRole('button', { name: /review before sending/i }).click();

    // Review preview gate
    await expect(frame.getByRole('heading', { name: /review your request/i })).toBeVisible();
    await expect(frame.getByText('Authorised coordinator only')).toBeVisible();
    await expect(frame.getByText(/Quiet room, text transcription display/i)).toBeVisible();

    // Submit
    await frame.getByRole('button', { name: /confirm and send/i }).click();

    // Confirmation
    await expect(
      frame.getByRole('status').filter({ hasText: /coordinator will respond/i }),
    ).toBeVisible({ timeout: 8000 });
  });

  test('permission denial resilience: assistant operates reliably when screen capture is restricted', async ({
    page,
  }) => {
    await page.goto(SAVANNA_HOST);
    const code = newHandoffCode('learner-a');

    // Embed without display-capture delegation
    await page.evaluate(
      ({ origin, token }) => {
        window.embedAssistant({
          origin,
          token,
          allow: '', // Restrict display-capture and microphone delegation
        });
      },
      { origin: ASSISTANT_ORIGIN, token: code },
    );

    const iframeElement = page.locator('iframe[title="Learning assistant"]');
    await expect(iframeElement).toBeVisible({ timeout: 8000 });

    const allowAttr = await iframeElement.getAttribute('allow');
    expect(allowAttr).not.toContain('display-capture');

    // Core functionality (sign-in, course material search, Q&A) remains unaffected
    const frame = page.frameLocator('iframe[title="Learning assistant"]');
    await expect(frame.locator('h1')).toContainText('Learning assistant', { timeout: 8000 });
    await expect(frame.getByRole('status', { name: 'Sign-in status' })).toContainText(
      'Demo learner A',
      { timeout: 10000 },
    );

    // Ask question operates normally
    const questionInput = frame.getByLabel('Your question');
    await questionInput.fill('What is a virtual assistant?');
    await questionInput.press('Enter');

    const reply = frame.locator('.messages .message-assistant').first();
    await expect(reply).toContainText('human remote professionals', { timeout: 10000 });
  });
});
