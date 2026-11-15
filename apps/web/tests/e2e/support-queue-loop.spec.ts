// End-to-end full loop test for Support Queue (T3-055).
// Tests the complete lifecycle through the UI:
// 1. Learner submits a help request via web UI.
// 2. Support staff claims the request from the waiting queue via web UI.
// 3. Support staff replies to the learner via web UI.
// 4. Learner sees the reply in their inbox and sends a response via web UI.
// 5. Support staff sees the response and resolves the request via web UI.
// 6. Learner sees the request is marked as resolved.
import { expect, test, type Page } from '@playwright/test';
import { newHandoffCode, runApi } from './demo-api.ts';

test.beforeAll(() => {
  runApi('src/provision-demo.ts');
  runApi(
    '-e',
    'import pg from "pg"; import { loadDatabaseConfig } from "./src/bootstrap/config.ts"; const pool = new pg.Pool(loadDatabaseConfig(process.env)); await pool.query("DELETE FROM help_request_replies; DELETE FROM help_requests;"); await pool.end();',
  );
});

async function signIn(page: Page, principal: string) {
  await page.goto('about:blank');
  await page.goto(`/#handoff=${newHandoffCode(principal)}`);
  await expect(page.getByRole('status', { name: 'Sign-in status' })).toContainText('Signed in');
}

test('complete support queue loop: learner requests -> support claims and replies -> learner replies -> support resolves', async ({
  page,
}) => {
  const uniqueContext = `Help request loop test context ${Date.now()}`;
  const supportReplyText = `Support reply message ${Date.now()}`;
  const learnerReplyText = `Learner follow-up message ${Date.now()}`;

  // ---------------------------------------------------------------------------
  // 1. Learner submits a help request via the UI
  // ---------------------------------------------------------------------------
  await signIn(page, 'learner-a');

  // Open "Request human help" form
  const requestHelpBtn = page
    .getByRole('button', { name: /request human help|request help/i })
    .first();
  await requestHelpBtn.click();

  const contextInput = page.getByLabel(/your context/i);
  await contextInput.fill(uniqueContext);

  const reviewBtn = page.getByRole('button', { name: /review before sending/i }).first();
  await reviewBtn.click();

  await expect(page.getByRole('region', { name: /what will be shared/i })).toBeVisible();

  const confirmSendBtn = page.getByRole('button', { name: /confirm and send/i }).first();
  await confirmSendBtn.click();

  // Verify request appears in learner's waiting status
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: /waiting/i })
      .first(),
  ).toBeVisible();

  // ---------------------------------------------------------------------------
  // 2. Support staff claims the request and sends a reply
  // ---------------------------------------------------------------------------
  await signIn(page, 'support');

  // Verify Support Help Queue panel is present
  await expect(page.getByRole('heading', { name: 'Support Help Queue' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Waiting help requests' })).toBeVisible();

  // Find the waiting request and claim it
  const claimButton = page
    .locator('.support-waiting-item')
    .filter({ has: page.getByRole('button', { name: /^claim$/i }) })
    .last()
    .getByRole('button', { name: /^claim$/i });

  await claimButton.click();

  // Verify the request moves to "My claimed requests" with the shared context snapshot
  await expect(page.getByRole('heading', { name: 'My claimed requests' })).toBeVisible();
  const assignedItem = page.locator('.support-assigned-item').filter({ hasText: uniqueContext });
  await expect(assignedItem).toBeVisible({ timeout: 10000 });
  await expect(assignedItem.locator('.context-text')).toContainText(uniqueContext);

  // Type and send a reply as support
  const replyTextarea = assignedItem.getByPlaceholder(/type your reply/i);
  await replyTextarea.fill(supportReplyText);

  const sendReplyBtn = assignedItem.getByRole('button', { name: /^send$/i });
  await sendReplyBtn.click();

  // Verify reply appears in the conversation thread
  await expect(assignedItem.getByText(supportReplyText)).toBeVisible({ timeout: 10000 });

  // ---------------------------------------------------------------------------
  // 3. Learner views support reply and responds
  // ---------------------------------------------------------------------------
  await signIn(page, 'learner-a');

  // Locate the request item in the inbox by the support reply text
  const learnerReqItem = page.locator('.help-inbox-item').filter({ hasText: supportReplyText });
  await expect(learnerReqItem).toBeVisible({ timeout: 10000 });

  // Status should now be "Being handled by staff"
  await expect(learnerReqItem.getByText(/being handled by staff/i)).toBeVisible();

  // Support reply should be visible in the thread
  await expect(learnerReqItem.getByText(supportReplyText)).toBeVisible({ timeout: 10000 });

  // Learner sends a follow-up reply
  const replyButton = learnerReqItem.getByRole('button', { name: /^reply$/i });
  await replyButton.click();
  const learnerReplyTextarea = learnerReqItem.getByLabel(/your reply/i);
  await learnerReplyTextarea.fill(learnerReplyText);

  const learnerSendBtn = learnerReqItem.getByRole('button', { name: /^send$/i });
  await learnerSendBtn.click();

  // Verify learner reply appears in the thread
  await expect(learnerReqItem.getByText(learnerReplyText)).toBeVisible({ timeout: 10000 });

  // ---------------------------------------------------------------------------
  // 4. Support staff marks the request as resolved
  // ---------------------------------------------------------------------------
  await signIn(page, 'support');

  const supportReqItem = page.locator('.support-assigned-item').filter({ hasText: uniqueContext });
  await expect(supportReqItem).toBeVisible({ timeout: 10000 });

  // Support sees learner's follow-up reply
  await expect(supportReqItem.getByText(learnerReplyText)).toBeVisible({ timeout: 10000 });

  // Click "Mark resolved"
  const resolveBtn = supportReqItem.getByRole('button', { name: /mark resolved/i });
  await resolveBtn.click();

  // Request should disappear from assigned list
  await expect(
    page.locator('.support-assigned-item').filter({ hasText: uniqueContext }),
  ).toHaveCount(0, {
    timeout: 10000,
  });

  // ---------------------------------------------------------------------------
  // 5. Learner sees the request status updated to Resolved
  // ---------------------------------------------------------------------------
  await signIn(page, 'learner-a');

  const resolvedReqItem = page.locator('.help-inbox-item').filter({ hasText: supportReplyText });
  await expect(resolvedReqItem).toBeVisible({ timeout: 10000 });
  await expect(resolvedReqItem.getByText(/resolved/i)).toBeVisible();
});
