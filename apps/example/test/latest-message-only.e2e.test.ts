import { test, expect } from '@playwright/test';

test.describe('AI responds to latest message only', () => {
  // Set timeout for all tests in this suite to 45 seconds
  test.setTimeout(45000);

  test.beforeAll(() => {
    // Skip all tests if ANTHROPIC_API_KEY is not set
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log('Skipping E2E tests: ANTHROPIC_API_KEY environment variable not set');
      console.log('Set it with: export ANTHROPIC_API_KEY=your_api_key_here');
    }
  });

  test.beforeEach(async ({ page }) => {
    // Skip if no API key
    if (!process.env.ANTHROPIC_API_KEY) {
      test.skip();
    }

    // Navigate to the todo page
    await page.goto('/');
    await page.click('text=Todo List');

    // Wait for the page to load
    await expect(page.locator('h1:has-text("Todo List")')).toBeVisible();
  });

  test('AI should respond to latest message only, not entire history', async ({ page }) => {
    // This test verifies that when a user sends a follow-up message,
    // the AI should take action based ONLY on the latest message,
    // using the conversation history as context but not as actionable instructions.
    //
    // Scenario:
    // 1. User: "add a shopping list to make tonkatsu ramen"
    //    -> AI adds multiple items to todo list
    // 2. User: "delete it"
    //    -> AI should delete the items that were just added (NOT ask for clarification or add more items)

    // Open AI chat
    const aiButton = page.getByTestId('ai-button');
    await expect(aiButton).toBeVisible({ timeout: 10000 });
    await aiButton.click();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

    const chatInput = page.getByTestId('chat-input');
    const sendButton = page.getByTestId('chat-send-button');

    // Step 1: Ask AI to add shopping list for tonkatsu ramen
    console.log('[Test] Step 1: Adding shopping list for tonkatsu ramen');
    await chatInput.fill('add a shopping list to make tonkatsu ramen');
    await sendButton.click();

    // Wait for AI to add items
    await page.waitForTimeout(3000);

    // Wait for AI response confirming items were added
    await expect(async () => {
      const messages = await page.getByTestId('chat-message-assistant').all();
      expect(messages.length).toBeGreaterThan(0);
    }).toPass({ timeout: 30000, intervals: [1000] });

    // Close chat to verify items were added to todo list
    const closeButton = page.getByTestId('chat-close-button');
    await closeButton.click();
    await page.waitForTimeout(500);

    // Count the number of todos added (should be several items for ramen shopping list)
    const todoItems = await page.locator('li').filter({ hasText: /ramen|pork|panko|miso|nori|eggs|flour|stock|noodles|green onions|vegetable oil|garlic|ginger/i }).all();
    const itemCount = todoItems.length;
    console.log(`[Test] ${itemCount} todo items found after adding shopping list`);
    expect(itemCount).toBeGreaterThan(3); // Should have multiple items

    // Step 2: Ask AI to delete the shopping list
    console.log('[Test] Step 2: Asking AI to delete the shopping list');
    await aiButton.click();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

    await chatInput.fill('delete it');
    await sendButton.click();

    // Wait for AI response
    await page.waitForTimeout(3000);

    await expect(async () => {
      const messages = await page.getByTestId('chat-message-assistant').all();
      expect(messages.length).toBeGreaterThan(1); // Should have at least 2 messages (add confirmation + delete confirmation)

      const lastMessage = await messages[messages.length - 1].textContent();
      console.log(`[Test] Last AI message: ${lastMessage?.substring(0, 200)}`);

      // The AI should have deleted the items and confirmed it
      // It should NOT be asking for clarification like "do you want me to add and then delete?"
      expect(lastMessage?.toLowerCase()).toMatch(/deleted|removed|cleared/);

      // It should NOT be asking questions like "could you clarify" or "would you like me to"
      expect(lastMessage?.toLowerCase()).not.toMatch(/clarify|could you|would you like me to|which specific/);
    }).toPass({ timeout: 30000, intervals: [2000] });

    // Close chat and verify items were deleted
    await closeButton.click();
    await page.waitForTimeout(1000);

    // Verify that the shopping list items are gone
    const remainingTodoItems = await page.locator('li').filter({ hasText: /ramen|pork|panko|miso|nori|eggs|flour|stock|noodles|green onions|vegetable oil|garlic|ginger/i }).all();
    const remainingCount = remainingTodoItems.length;
    console.log(`[Test] ${remainingCount} todo items remaining after deletion (should be 0)`);

    // All items should be deleted
    expect(remainingCount).toEqual(0);
  });
});
