import { test, expect, Page, Locator } from '@playwright/test';

test.describe('Tool Approval', () => {
  // Set timeout for all tests in this suite
  test.setTimeout(120000);

  test.beforeAll(() => {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log('Skipping E2E tests: ANTHROPIC_API_KEY environment variable not set');
      console.log('Set it with: export ANTHROPIC_API_KEY=your_api_key_here');
    }
  });

  test.beforeEach(async ({ page }) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      test.skip();
    }

    // Navigate to the todo page
    await page.goto('/');
    await expect(page.locator('h1:has-text("Todo List")')).toBeVisible();
  });

  /**
   * Helper to get todo items (li elements in the todo list)
   */
  function getTodoItems(page: import('@playwright/test').Page) {
    return page.locator('ul li');
  }

  /**
   * Helper to check if a todo with specific text exists
   */
  function getTodoWithText(page: import('@playwright/test').Page, text: string) {
    return page.locator('ul li').filter({ hasText: text });
  }

  /**
   * Helper to open the chat panel and get common elements
   */
  async function openChat(page: import('@playwright/test').Page) {
    const aiButton = page.getByTestId('ai-button');
    await expect(aiButton).toBeVisible({ timeout: 10000 });
    await aiButton.click();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

    return {
      chatInput: page.getByTestId('chat-input'),
      sendButton: page.getByTestId('chat-send-button'),
      approvalDialog: page.getByTestId('tool-approval-dialog'),
      approveButton: page.getByTestId('approve-tool-button'),
      rejectButton: page.getByTestId('reject-tool-button'),
    };
  }

  /**
   * Handle up to N rounds of the approval dialog. TOOL_APPROVAL_REQUEST events
   * arrive incrementally, so the dialog may re-appear after a click if more
   * pending tools arrive. Only the first round waits with a timeout; subsequent
   * rounds use instant visibility checks.
   */
  async function handleToolApprovals(
    page: Page,
    approvalDialog: Locator,
    actionButton: Locator,
    maxRounds: number,
  ) {
    await expect(approvalDialog).toBeVisible({ timeout: 30000 });
    await actionButton.click();

    for (let i = 1; i < maxRounds; i++) {
      await page.waitForTimeout(200);
      if (!(await approvalDialog.isVisible())) break;
      await actionButton.click();
    }
  }

  /**
   * Helper to send a message
   */
  async function sendMessage(
    chatInput: import('@playwright/test').Locator,
    sendButton: import('@playwright/test').Locator,
    message: string
  ) {
    await chatInput.fill(message);
    await sendButton.click();
  }

  /**
   * Helper to wait for AI response (assistant message)
   */
  async function waitForAssistantResponse(page: import('@playwright/test').Page, timeout = 30000) {
    const messageCountBefore = await page.getByTestId('chat-message-assistant').count();
    await expect(async () => {
      const messageCountAfter = await page.getByTestId('chat-message-assistant').count();
      expect(messageCountAfter).toBeGreaterThan(messageCountBefore);
    }).toPass({ timeout, intervals: [1000] });
  }

  test('single tool approval - approve and deny in multi-turn conversation', async ({ page }) => {
    const { chatInput, sendButton, approvalDialog, approveButton, rejectButton } = await openChat(page);

    // === TURN 1: Test DENY flow ===
    // Add a todo first
    await sendMessage(chatInput, sendButton, 'Add a todo: call dentist');
    await waitForAssistantResponse(page);
    await expect(getTodoWithText(page, 'call dentist')).toBeVisible();
    await expect(getTodoItems(page)).toHaveCount(1);

    // Ask to delete it
    await sendMessage(chatInput, sendButton, 'Delete the dentist todo');

    // Wait for approval dialog
    await expect(approvalDialog).toBeVisible({ timeout: 30000 });

    // Verify UI elements for single approval
    const dialogText = await approvalDialog.textContent();
    expect(dialogText).toContain('waiting for your approval');
    expect(dialogText).toContain('Deleting Todo');
    await expect(approveButton).toHaveText('Allow');
    await expect(rejectButton).toHaveText('Deny');

    // Verify chat input is replaced by approval dialog
    await expect(chatInput).not.toBeVisible();

    // Verify "Show details" works
    const showDetailsButton = approvalDialog.locator('button:has-text("Show details")');
    await showDetailsButton.click();
    const detailsContent = await approvalDialog.textContent();
    expect(detailsContent).toContain('id');

    // DENY the action
    await rejectButton.click();
    await waitForAssistantResponse(page);

    // Verify todo is still present (was not deleted) - exactly 1 todo
    await expect(getTodoWithText(page, 'call dentist')).toBeVisible();
    await expect(getTodoItems(page)).toHaveCount(1);

    // Verify chat input is back
    await expect(chatInput).toBeVisible();

    // === TURN 2: Test APPROVE flow ===
    // Ask to delete the same todo again
    await sendMessage(chatInput, sendButton, 'Delete the dentist todo');

    // Wait for approval dialog
    await expect(approvalDialog).toBeVisible({ timeout: 30000 });

    // Verify todo still exists before approval
    await expect(getTodoWithText(page, 'call dentist')).toBeVisible();

    // APPROVE the action
    await approveButton.click();
    await waitForAssistantResponse(page);

    // Verify todo is now deleted - exactly 0 todos
    await expect(getTodoWithText(page, 'call dentist')).not.toBeVisible();
    await expect(getTodoItems(page)).toHaveCount(0);
  });

  test('auto-reject should not persist across separate tool call groups within a run', async ({ page }) => {
    // Clear ALL localStorage to avoid stale state from previous tests
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.locator('h1:has-text("Todo List")')).toBeVisible();
    await expect(getTodoItems(page)).toHaveCount(0);

    const { chatInput, sendButton, approvalDialog, approveButton, rejectButton } = await openChat(page);

    // === Run 1: Add a todo, then try to delete it (deny) ===
    await sendMessage(chatInput, sendButton, 'Add a todo: call mom');
    await waitForAssistantResponse(page);
    await expect(getTodoWithText(page, 'call mom')).toBeVisible();

    await sendMessage(chatInput, sendButton, 'Delete the call mom todo');
    await expect(approvalDialog).toBeVisible({ timeout: 30000 });

    // DENY the deletion
    await rejectButton.click();
    await waitForAssistantResponse(page);

    // Verify todo is still present
    await expect(getTodoWithText(page, 'call mom')).toBeVisible();
    await expect(getTodoItems(page)).toHaveCount(1);

    // === Run 2: Add another todo, then try to delete it (should still prompt) ===
    // This verifies auto-reject state was properly cleared between runs.
    await sendMessage(chatInput, sendButton, 'Add a todo: call dad');
    await waitForAssistantResponse(page);
    await expect(getTodoWithText(page, 'call dad')).toBeVisible();

    await sendMessage(chatInput, sendButton, 'Delete the call dad todo');

    // This would fail if auto-reject incorrectly persists across runs — the
    // deletion would be silently rejected without ever showing the dialog.
    await expect(approvalDialog).toBeVisible({ timeout: 30000 });

    // APPROVE this deletion
    await approveButton.click();
    await waitForAssistantResponse(page);

    // "call dad" should be deleted, "call mom" should still exist
    await expect(getTodoWithText(page, 'call dad')).not.toBeVisible({ timeout: 10000 });
    await expect(getTodoWithText(page, 'call mom')).toBeVisible();
  });

  test('bulk tool approval - approve and deny in multi-turn conversation', async ({ page }) => {
    const { chatInput, sendButton, approvalDialog, approveButton, rejectButton } = await openChat(page);

    // === TURN 1: Create todos and test DENY flow ===
    // Create multiple todos
    await sendMessage(chatInput, sendButton, 'Add 3 todos: buy milk, buy eggs, buy bread');
    await waitForAssistantResponse(page);

    // Wait for todos to be created (at least 1)
    await expect(getTodoItems(page).first()).toBeVisible({ timeout: 10000 });

    // Capture actual count (AI may create more or fewer than requested)
    const todoCountAfterCreate = await getTodoItems(page).count();
    expect(todoCountAfterCreate).toBeGreaterThanOrEqual(1);

    // Ask to delete all
    await sendMessage(chatInput, sendButton, 'Delete all todos');

    // Wait for approval dialog
    await expect(approvalDialog).toBeVisible({ timeout: 30000 });

    // Verify approval dialog shows with correct message
    const dialogText = await approvalDialog.textContent();
    expect(dialogText).toMatch(/waiting for your approval/);
    // In batch mode, shows "N actions" with "Allow All" / "Deny All" buttons
    // In single mode, shows "Deleting Todo" with "Allow" / "Deny" buttons
    const isBatchMode = dialogText?.includes('actions are waiting');
    if (isBatchMode) {
      await expect(approveButton).toHaveText('Allow All');
      await expect(rejectButton).toHaveText('Deny All');
    } else {
      expect(dialogText).toContain('Deleting Todo');
      await expect(approveButton).toHaveText('Allow');
      await expect(rejectButton).toHaveText('Deny');
    }

    // DENY the deletion (handle multiple rounds if tool requests arrive incrementally)
    await handleToolApprovals(page, approvalDialog, rejectButton, todoCountAfterCreate);

    // Wait for AI to acknowledge the denial
    await waitForAssistantResponse(page);

    // Verify dialog closes
    await expect(approvalDialog).not.toBeVisible({ timeout: 10000 });

    // Verify no todos were deleted (count >= before, AI might have added more)
    const todoCountAfterDeny = await getTodoItems(page).count();
    expect(todoCountAfterDeny).toBeGreaterThanOrEqual(todoCountAfterCreate);

    // === TURN 2: Test APPROVE flow ===
    // Ask to delete all again
    await sendMessage(chatInput, sendButton, 'Delete all the todos');

    // Wait for approval dialog
    await expect(approvalDialog).toBeVisible({ timeout: 30000 });

    // Expand details to verify tool info is shown
    const showDetailsButton = approvalDialog.locator('button:has-text("Show details")');
    await showDetailsButton.click();
    const detailsContent = await approvalDialog.textContent();
    expect(detailsContent).toContain('Deleting Todo');
    expect(detailsContent).toContain('id'); // Tool arguments should show

    // Capture count before approve
    const todoCountBeforeApprove = await getTodoItems(page).count();

    // APPROVE the deletion (handle multiple rounds if tool requests arrive incrementally)
    await handleToolApprovals(page, approvalDialog, approveButton, todoCountBeforeApprove);

    // Verify dialog closes (approval was processed)
    await expect(approvalDialog).not.toBeVisible({ timeout: 10000 });

    // Verify at least one todo was deleted (count decreased)
    // Note: AI processes deletions sequentially, so only one deletion happens per approval
    await expect(async () => {
      const currentCount = await getTodoItems(page).count();
      expect(currentCount).toBeLessThan(todoCountBeforeApprove);
    }).toPass({ timeout: 10000, intervals: [500] });
  });
});
