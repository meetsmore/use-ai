import { test, expect } from '@playwright/test';

test.describe('Invisible Component Tests', () => {
  test.setTimeout(30000);

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
  });

  test('invisible component tools execute without render wait', async ({ page }) => {
    // This test verifies that tools from invisible components (e.g. providers)
    // don't hang waiting for renders since they have no visual state
    // The InvisibleAIProvider is added globally in index.tsx

    // Navigate to any page (using Todo page)
    await page.goto('/');
    await expect(page.locator('h1:has-text("use-ai Demo")')).toBeVisible({ timeout: 10000 });

    // Open AI chat
    const aiButton = page.getByTestId('ai-button');
    await expect(aiButton).toBeVisible({ timeout: 10000 });
    await aiButton.click();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

    const chatInput = page.getByTestId('chat-input');
    const sendButton = page.getByTestId('chat-send-button');

    // Call the logMessage tool from the invisible provider
    // This tool doesn't update any UI state and should respond immediately
    await chatInput.fill('Log a message: Hello from invisible component');
    await sendButton.click();

    // The tool should execute and respond immediately without hanging
    // Even though the invisible provider component doesn't re-render
    console.log('Waiting for AI response after invisible tool execution...');
    await page.waitForTimeout(2000);

    await expect(async () => {
      const messages = await page.getByTestId('chat-message-assistant').all();
      console.log(`[Test] Found ${messages.length} assistant messages`);

      expect(messages.length).toBeGreaterThan(0);
      const lastMessage = await messages[messages.length - 1].textContent();
      console.log(`[Test] Last message: ${lastMessage?.substring(0, 80)}`);

      // AI should have logged the message and responded
      expect(lastMessage?.toLowerCase()).toMatch(/logged|message|hello/);
    }).toPass({ timeout: 15000, intervals: [1000] });

    const response = await page.getByTestId('chat-message-assistant').last().textContent();
    console.log('Invisible tool response:', response?.substring(0, 100));

    // Verify we got a response (tool didn't hang)
    expect(response).toBeTruthy();
    expect(response!.length).toBeGreaterThan(0);
  });
});
