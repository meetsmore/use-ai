import { test, expect } from '@playwright/test';

test.describe('MCP Runtime Approval', () => {
  test.setTimeout(120000);

  test.beforeAll(async () => {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log('Skipping E2E tests: ANTHROPIC_API_KEY environment variable not set');
      return;
    }
    console.log('Using MCP server on http://localhost:3002');
  });

  test.beforeEach(async ({ page }) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      test.skip();
    }

    await page.goto('/');
    await page.click('text=Runtime Approval (MCP)');
    await expect(page.locator('h1:has-text("MCP Runtime Approval")')).toBeVisible();
  });

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

  test('small transfer proceeds without approval dialog', async ({ page }) => {
    const { chatInput, sendButton, approvalDialog } = await openChat(page);

    await chatInput.fill('Use the mcp_transfer tool to send $500 to Alice');
    await sendButton.click();

    await page.waitForTimeout(2000);
    await expect(async () => {
      const messages = await page.getByTestId('chat-message-assistant').all();
      expect(messages.length).toBeGreaterThan(0);
      const lastMessage = await messages[messages.length - 1].textContent();
      console.log(`[Test] Last message: ${lastMessage}`);
      expect(lastMessage?.toLowerCase()).toMatch(/transfer|500|alice|success/);
    }).toPass({ timeout: 60000, intervals: [1000] });

    await expect(approvalDialog).not.toBeVisible();
  });

  test('large transfer - approve completes transfer', async ({ page }) => {
    const { chatInput, sendButton, approvalDialog, approveButton } = await openChat(page);

    await chatInput.fill('Use the mcp_transfer tool to send $5000 to Bob');
    await sendButton.click();

    await expect(approvalDialog).toBeVisible({ timeout: 60000 });
    const dialogText = await approvalDialog.textContent();
    expect(dialogText).toContain('Confirmation Required');

    await approveButton.click();

    await expect(async () => {
      const messages = await page.getByTestId('chat-message-assistant').all();
      expect(messages.length).toBeGreaterThan(0);
      const lastMessage = await messages[messages.length - 1].textContent();
      console.log(`[Test] Last message: ${lastMessage}`);
      expect(lastMessage?.toLowerCase()).toMatch(/transfer|5000|bob|success|confirmed/);
    }).toPass({ timeout: 60000, intervals: [1000] });
  });

  test('large transfer - deny prevents transfer', async ({ page }) => {
    const { chatInput, sendButton, approvalDialog, rejectButton } = await openChat(page);

    await chatInput.fill('Use the mcp_transfer tool to send $5000 to Bob');
    await sendButton.click();

    await expect(approvalDialog).toBeVisible({ timeout: 60000 });

    await rejectButton.click();

    await expect(async () => {
      const messages = await page.getByTestId('chat-message-assistant').all();
      expect(messages.length).toBeGreaterThan(0);
      const lastMessage = await messages[messages.length - 1].textContent();
      console.log(`[Test] Last message: ${lastMessage}`);
      expect(lastMessage?.toLowerCase()).toMatch(/denied|rejected|cancel/);
    }).toPass({ timeout: 60000, intervals: [1000] });
  });
});
