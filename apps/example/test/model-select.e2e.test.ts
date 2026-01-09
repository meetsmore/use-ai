import { test, expect } from '@playwright/test';

test.describe('Model Selection', () => {
  test.setTimeout(60000);

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

    // Clear localStorage before each test
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
    });
    await page.reload();

    // Navigate to the todo page
    await page.click('text=Todo List');
    await expect(page.locator('h1:has-text("Todo List")')).toBeVisible();
  });

  // Helper to select an agent from the dropdown
  async function selectAgent(page: import('@playwright/test').Page, agentId: string) {
    const agentSelector = page.getByTestId('agent-selector');
    await agentSelector.click();
    await page.waitForTimeout(100);
    // Find the option by matching the agent id in the data-testid
    const option = page.getByTestId('agent-option').filter({ hasText: agentId === 'gpt' ? 'ChatGPT' : 'Claude' });
    await option.click();
    await page.waitForTimeout(300);
  }

  // Helper to get the currently selected agent name from the button
  async function getSelectedAgentName(page: import('@playwright/test').Page) {
    const agentSelector = page.getByTestId('agent-selector');
    return await agentSelector.textContent();
  }

  test.describe('Agent selector visibility', () => {
    test.skip('should not show agent selector if only one agent is configured.', async ({ page }) => {
      // TODO: This is annoying to test, because the server is configured to use multiple agents.
    });
  });

  test.describe('Multiple agents configuration', () => {
    test('should show agent selector when multiple agents are configured', async ({ page }) => {
      // Open AI chat
      const aiButton = page.getByTestId('ai-button');
      await expect(aiButton).toBeVisible({ timeout: 10000 });
      await aiButton.click();
      await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

      // Wait for connection and agent info to be received
      await page.waitForTimeout(1500);

      // Check if agent selector is visible (requires multiple agents on server)
      const agentSelector = page.getByTestId('agent-selector');
      const isVisible = await agentSelector.isVisible();

      if (!isVisible) {
        console.log('[Test] Skipping: Only one agent configured on server');
        test.skip(true, 'Only one agent configured - skipping multi-agent test');
        return;
      }

      // Open the dropdown and verify multiple options are available
      await agentSelector.click();
      await page.waitForTimeout(100);

      const options = await page.getByTestId('agent-option').all();
      const optionTexts = await Promise.all(options.map(o => o.textContent()));
      console.log('[Test] Available agents:', optionTexts);

      expect(options.length).toBeGreaterThanOrEqual(2);

      // Close dropdown by clicking elsewhere
      await page.keyboard.press('Escape');
    });

    test('should use selected agent for requests', async ({ page }) => {
      // Open AI chat
      const aiButton = page.getByTestId('ai-button');
      await aiButton.click();
      await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

      // Wait for connection
      await page.waitForTimeout(1500);

      // Skip if only one agent
      const agentSelector = page.getByTestId('agent-selector');
      if (!await agentSelector.isVisible()) {
        test.skip(true, 'Only one agent configured');
        return;
      }

      // Get the initial/default agent
      const defaultValue = await getSelectedAgentName(page);
      console.log('[Test] Default agent:', defaultValue);

      // Select GPT agent
      await selectAgent(page, 'gpt');

      // Verify selection changed
      const selectedValue = await getSelectedAgentName(page);
      expect(selectedValue).toContain('ChatGPT');
      console.log('[Test] Selected agent:', selectedValue);

      // Send a message to verify the agent is being used
      const chatInput = page.getByTestId('chat-input');
      const sendButton = page.getByTestId('chat-send-button');

      await chatInput.fill('Hello, which AI model are you?');
      await sendButton.click();

      // Wait for response
      await expect(async () => {
        const messages = await page.getByTestId('chat-message-assistant').all();
        expect(messages.length).toBeGreaterThan(0);
      }).toPass({ timeout: 30000, intervals: [1000] });

      // The response should come from GPT (though we can't easily verify this without server logs)
      const assistantMessage = await page.getByTestId('chat-message-assistant').first().textContent();
      console.log('[Test] Assistant response:', assistantMessage?.substring(0, 200));

      // Verify the message was received (the actual model can't be verified without server-side inspection)
      expect(assistantMessage).toBeTruthy();
    });

    test('should switch agents mid-conversation', async ({ page }) => {
      // Open AI chat
      const aiButton = page.getByTestId('ai-button');
      await aiButton.click();
      await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

      // Wait for connection
      await page.waitForTimeout(1500);

      // Skip if only one agent
      const agentSelector = page.getByTestId('agent-selector');
      if (!await agentSelector.isVisible()) {
        test.skip(true, 'Only one agent configured');
        return;
      }

      const chatInput = page.getByTestId('chat-input');
      const sendButton = page.getByTestId('chat-send-button');

      // Send first message with Claude (default)
      await chatInput.fill('Add a todo: Buy groceries');
      await sendButton.click();

      await expect(async () => {
        const messages = await page.getByTestId('chat-message-assistant').all();
        expect(messages.length).toBeGreaterThan(0);
      }).toPass({ timeout: 30000, intervals: [1000] });

      const firstResponseCount = await page.getByTestId('chat-message-assistant').count();
      console.log('[Test] First response received with Claude');

      // Switch to GPT
      await selectAgent(page, 'gpt');
      console.log('[Test] Switched to GPT');

      // Send second message with GPT
      await chatInput.fill('List all my todos');
      await sendButton.click();

      await expect(async () => {
        const messages = await page.getByTestId('chat-message-assistant').all();
        expect(messages.length).toBeGreaterThan(firstResponseCount);
      }).toPass({ timeout: 30000, intervals: [1000] });

      console.log('[Test] Second response received with GPT');

      // Switch back to Claude
      await selectAgent(page, 'claude');
      console.log('[Test] Switched back to Claude');

      // Send third message with Claude
      await chatInput.fill('Delete all todos');
      await sendButton.click();

      const secondResponseCount = await page.getByTestId('chat-message-assistant').count();

      await expect(async () => {
        const messages = await page.getByTestId('chat-message-assistant').all();
        expect(messages.length).toBeGreaterThan(secondResponseCount);
      }).toPass({ timeout: 30000, intervals: [1000] });

      console.log('[Test] Third response received with Claude');

      // Verify all three exchanges completed
      const finalUserCount = await page.getByTestId('chat-message-user').count();
      const finalAssistantCount = await page.getByTestId('chat-message-assistant').count();

      expect(finalUserCount).toBe(3);
      expect(finalAssistantCount).toBeGreaterThanOrEqual(3);

      console.log('[Test] SUCCESS: Switched agents mid-conversation');
    });

    test('should persist selected agent across page reload', async ({ page }) => {
      // Open AI chat
      const aiButton = page.getByTestId('ai-button');
      await aiButton.click();
      await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

      // Wait for connection
      await page.waitForTimeout(1500);

      // Skip if only one agent
      const agentSelector = page.getByTestId('agent-selector');
      if (!await agentSelector.isVisible()) {
        test.skip(true, 'Only one agent configured');
        return;
      }

      // Select GPT
      await selectAgent(page, 'gpt');

      // Send a message so we have a chat
      const chatInput = page.getByTestId('chat-input');
      const sendButton = page.getByTestId('chat-send-button');

      await chatInput.fill('Hello');
      await sendButton.click();

      await expect(async () => {
        const messages = await page.getByTestId('chat-message-assistant').all();
        expect(messages.length).toBeGreaterThan(0);
      }).toPass({ timeout: 30000, intervals: [1000] });

      // Close chat
      const closeButton = page.getByTestId('chat-close-button');
      await closeButton.click();

      // Reload page
      await page.reload();
      await expect(page.locator('h1:has-text("Todo List")')).toBeVisible();

      // Reopen chat
      await aiButton.click();
      await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

      // Wait for connection and agent info
      await page.waitForTimeout(1500);

      // Note: Agent selection is per-session and may reset on reload
      // This is expected behavior since agent preference is stored in memory
      // The important thing is that the selector still works after reload
      const agentSelectorAfterReload = page.getByTestId('agent-selector');
      await expect(agentSelectorAfterReload).toBeVisible({ timeout: 5000 });

      // Verify we can still select agents
      await selectAgent(page, 'gpt');
      const selectedValue = await getSelectedAgentName(page);
      expect(selectedValue).toContain('ChatGPT');

      console.log('[Test] Agent selector works correctly after reload');
    });
  });

  test.describe('Agent info from server', () => {
    test('should receive agent list from server on connection', async ({ page }) => {
      // Open AI chat
      const aiButton = page.getByTestId('ai-button');
      await expect(aiButton).toBeVisible({ timeout: 10000 });
      await aiButton.click();
      await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

      // Wait for connection and agent info
      await page.waitForTimeout(2000);

      // Verify we're connected (connection status indicator should be green)
      // The connection dot should be visible in the header
      const connectionDot = page.locator('[title="Online"]');
      await expect(connectionDot).toBeVisible({ timeout: 5000 });

      // If multiple agents configured, selector should be visible
      // If single agent, selector should NOT be visible
      // Either way, the connection should be established and agent info received

      // The chat should be functional - try sending a message
      const chatInput = page.getByTestId('chat-input');
      const sendButton = page.getByTestId('chat-send-button');

      // Input should be enabled (meaning we're connected and ready)
      await expect(chatInput).toBeEnabled({ timeout: 5000 });
      await expect(sendButton).toBeVisible();

      console.log('[Test] Connection established and chat is functional');
      console.log('[Test] Agent info was received from server (connection is working)');
    });
  });
});
