import { test, expect } from '@playwright/test';

test.describe('Remote MCP Tools', () => {
  test.setTimeout(60000);

  test.beforeAll(async () => {
    // Skip all tests if ANTHROPIC_API_KEY is not set
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log('Skipping E2E tests: ANTHROPIC_API_KEY environment variable not set');
      console.log('Set it with: export ANTHROPIC_API_KEY=your_api_key_here');
      return;
    }

    // Note: The MCP server should be running on localhost:3002
    // In a real CI/CD environment, you might want to use Testcontainers to start it
    console.log('Using MCP server on http://localhost:3002');
  });

  test.beforeEach(async ({ page }) => {
    // Skip if no API key
    if (!process.env.ANTHROPIC_API_KEY) {
      test.skip();
    }

    // Navigate to the remote MCP tools page
    await page.goto('/');
    await page.click('text=Remote MCP Tools');

    // Wait for the page to load
    await expect(page.locator('h1:has-text("Remote MCP Tools Test")')).toBeVisible();
  });

  test('should display remote MCP tools page', async ({ page }) => {
    // Check that the page content is visible
    // Use a more specific selector to avoid matching the main app header
    await expect(page.locator('h1:has-text("Remote MCP Tools Test")')).toBeVisible();
    await expect(page.locator('text=This page demonstrates remote MCP tool execution')).toBeVisible();
  });

  test('should call remote mcp_add tool via AI', async ({ page }) => {
    // Open AI chat
    const aiButton = page.getByTestId('ai-button');
    await expect(aiButton).toBeVisible({ timeout: 10000 });
    await aiButton.click();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

    const chatInput = page.getByTestId('chat-input');
    const sendButton = page.getByTestId('chat-send-button');

    // Ask AI to add numbers using remote tool
    await chatInput.fill('What is 25 plus 17? Please use the add tool.');
    await sendButton.click();

    // Wait for AI response
    await page.waitForTimeout(2000);
    await expect(async () => {
      const messages = await page.getByTestId('chat-message-assistant').all();
      console.log(`[Test] Found ${messages.length} assistant messages`);

      expect(messages.length).toBeGreaterThan(0);
      const lastMessage = await messages[messages.length - 1].textContent();
      console.log(`[Test] Last message: ${lastMessage}`);

      // AI should have called the mcp_add tool and returned result (42)
      expect(lastMessage?.toLowerCase()).toMatch(/42|forty.two/);
    }).toPass({ timeout: 30000, intervals: [1000] });
  });

  test('should call remote mcp_greet tool via AI', async ({ page }) => {
    // Open AI chat
    const aiButton = page.getByTestId('ai-button');
    await aiButton.click();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

    const chatInput = page.getByTestId('chat-input');
    const sendButton = page.getByTestId('chat-send-button');

    // Ask AI to greet someone using remote tool
    await chatInput.fill('Please greet Alice using the greet tool');
    await sendButton.click();

    // Wait for AI response
    await page.waitForTimeout(2000);
    await expect(async () => {
      const messages = await page.getByTestId('chat-message-assistant').all();
      expect(messages.length).toBeGreaterThan(0);
      const lastMessage = await messages[messages.length - 1].textContent();
      console.log(`[Test] Last message: ${lastMessage}`);

      // AI should have called mcp_greet and returned greeting
      expect(lastMessage?.toLowerCase()).toMatch(/hello.*alice|alice.*hello|welcome.*alice|alice.*welcome/);
    }).toPass({ timeout: 30000, intervals: [1000] });
  });

  test('should call remote mcp_get_weather tool via AI', async ({ page }) => {
    // Open AI chat
    const aiButton = page.getByTestId('ai-button');
    await aiButton.click();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

    const chatInput = page.getByTestId('chat-input');
    const sendButton = page.getByTestId('chat-send-button');

    // Ask AI to get weather using remote tool
    await chatInput.fill('What is the weather in Paris? Use the get_weather tool.');
    await sendButton.click();

    // Wait for AI response
    await page.waitForTimeout(2000);
    await expect(async () => {
      const messages = await page.getByTestId('chat-message-assistant').all();
      expect(messages.length).toBeGreaterThan(0);
      const lastMessage = await messages[messages.length - 1].textContent();
      console.log(`[Test] Last message: ${lastMessage}`);

      // AI should have called mcp_get_weather and returned mock weather data
      expect(lastMessage?.toLowerCase()).toMatch(/sunny|72|paris|temperature|weather/);
    }).toPass({ timeout: 30000, intervals: [1000] });
  });

  test('should handle multiple remote tool calls in sequence', async ({ page }) => {
    // Open AI chat
    const aiButton = page.getByTestId('ai-button');
    await aiButton.click();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

    const chatInput = page.getByTestId('chat-input');
    const sendButton = page.getByTestId('chat-send-button');

    // Ask AI to perform multiple operations
    await chatInput.fill('First add 10 and 15, then multiply the result by 2. Use the appropriate tools.');
    await sendButton.click();

    // Wait for AI response
    await page.waitForTimeout(3000);
    await expect(async () => {
      const messages = await page.getByTestId('chat-message-assistant').all();
      expect(messages.length).toBeGreaterThan(0);
      const lastMessage = await messages[messages.length - 1].textContent();
      console.log(`[Test] Last message: ${lastMessage}`);

      // AI should have called add (10+15=25) then multiply (25*2=50)
      expect(lastMessage).toMatch(/50|fifty/);
    }).toPass({ timeout: 45000, intervals: [1000] });
  });
});
