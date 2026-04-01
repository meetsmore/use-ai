import { test, expect } from '@playwright/test';

test.describe('Server-Side Tools', () => {
  test.setTimeout(60000);

  test.beforeAll(async () => {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log('Skipping E2E tests: ANTHROPIC_API_KEY environment variable not set');
      console.log('Set it with: export ANTHROPIC_API_KEY=your_api_key_here');
      return;
    }
  });

  test.beforeEach(async ({ page }) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      test.skip();
    }

    // Navigate to the Server Tools page
    await page.goto('/');
    await page.click('button:text-is("Server Tools")');

    // Wait for the page to load
    await expect(page.locator('h1:has-text("Server Tools")')).toBeVisible();

    // Open AI chat
    const aiButton = page.getByTestId('ai-button');
    await expect(aiButton).toBeVisible({ timeout: 10000 });
    await aiButton.click();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });
  });

  test('should display server tools page', async ({ page }) => {
    await expect(page.locator('h1:has-text("Server Tools")')).toBeVisible();
    await expect(page.locator('text=About Server Tools')).toBeVisible();
  });

  test('should call getServerTime tool (no parameters)', async ({ page }) => {
    const chatInput = page.getByTestId('chat-input');
    const sendButton = page.getByTestId('chat-send-button');

    await chatInput.fill('What is the current server time? Use the getServerTime tool.');
    await sendButton.click();

    await page.waitForTimeout(2000);
    await expect(async () => {
      const messages = await page.getByTestId('chat-message-assistant').all();
      expect(messages.length).toBeGreaterThan(0);
      const lastMessage = await messages[messages.length - 1].textContent();
      console.log(`[Test] Last message: ${lastMessage}`);

      // AI should have called getServerTime and returned an ISO timestamp
      // Match common date/time patterns (ISO 8601, or natural language with year)
      expect(lastMessage).toMatch(/\d{4}[-/]\d{2}[-/]\d{2}|:\d{2}:|AM|PM|UTC|GMT/i);
    }).toPass({ timeout: 30000, intervals: [1000] });
  });

  test('should call addNumbers tool (with parameters)', async ({ page }) => {
    const chatInput = page.getByTestId('chat-input');
    const sendButton = page.getByTestId('chat-send-button');

    await chatInput.fill('What is 123 plus 456? Use the addNumbers tool.');
    await sendButton.click();

    await page.waitForTimeout(2000);
    await expect(async () => {
      const messages = await page.getByTestId('chat-message-assistant').all();
      expect(messages.length).toBeGreaterThan(0);
      const lastMessage = await messages[messages.length - 1].textContent();
      console.log(`[Test] Last message: ${lastMessage}`);

      // AI should have called addNumbers(123, 456) and returned 579
      expect(lastMessage).toContain('579');
    }).toPass({ timeout: 30000, intervals: [1000] });
  });

  test('should use server tools alongside client tools', async ({ page }) => {
    // Close the chat drawer before navigating so its backdrop does not intercept nav clicks
    await page.getByTestId('chat-close-button').click();

    // Navigate back to the Todo page where client tools are registered
    await page.getByRole('button', { name: 'Todo List' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Todo List' })).toBeVisible();

    // Reopen chat on the Todo page so both server and client tools are available in the same chat
    await page.getByTestId('ai-button').click();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

    const chatInput = page.getByTestId('chat-input');
    const sendButton = page.getByTestId('chat-send-button');

    // Ask AI to use a server tool (addNumbers) and a client tool (addTodo) in the same conversation
    await chatInput.fill(
      'First use addNumbers to add 10 and 20, then use the addTodo tool to add a todo with the text "Sum is 30".'
    );
    await sendButton.click();

    await page.waitForTimeout(3000);
    await expect(async () => {
      const messages = await page.getByTestId('chat-message-assistant').all();
      expect(messages.length).toBeGreaterThan(0);
      const lastMessage = await messages[messages.length - 1].textContent();
      console.log(`[Test] Last message: ${lastMessage}`);

      // AI should have used both tools successfully
      expect(lastMessage?.toLowerCase()).toMatch(/30|sum|added|todo/);
    }).toPass({ timeout: 45000, intervals: [1000] });

    // Verify the todo was actually added to the UI
    await expect(page.getByTestId('todo-item').filter({ hasText: 'Sum is 30' })).toBeVisible({ timeout: 5000 });
  });
});
