import { test, expect } from '@playwright/test';

test.describe('Todo List Edge Cases', () => {
  // Set timeout for all tests in this suite to 30 seconds
  test.setTimeout(30000);

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

  test('BUG FIX: Error tool results respond immediately without hanging', async ({ page }) => {
    // This test verifies the fix for the bug where tool error results would hang
    // waiting for component re-renders that never happen (because errors don't update UI state).
    //
    // The fix: Check if tool result has `success: false` or `error` property,
    // and skip the render wait in those cases.

    // Open AI chat
    const aiButton = page.getByTestId('ai-button');
    await expect(aiButton).toBeVisible({ timeout: 10000 });
    await aiButton.click();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

    const chatInput = page.getByTestId('chat-input');
    const sendButton = page.getByTestId('chat-send-button');

    // Try to toggle a non-existent todo (doesn't require confirmation, returns error)
    await chatInput.fill('Toggle todo with ID 999');
    await sendButton.click();

    // CRITICAL TEST: AI calls toggleTodo tool with non-existent ID
    // Tool returns error result: { success: false, error: "..." }
    // Our fix detects this and skips the render wait
    // Response should come back immediately (within seconds, not hanging forever)
    console.log('Waiting for AI response after error tool result...');

    await page.waitForTimeout(2000);
    await expect(async () => {
      const messages = await page.getByTestId('chat-message-assistant').all();
      console.log(`[Test] Found ${messages.length} assistant messages`);

      expect(messages.length).toBeGreaterThan(0);
      const lastMessage = await messages[messages.length - 1].textContent();
      console.log(`[Test] Last message: ${lastMessage?.substring(0, 80)}`);

      // AI should have received the error and responded
      // The AI may phrase it naturally like "there's no todo" or "it appears to be empty"
      expect(lastMessage?.toLowerCase()).toMatch(/not found|doesn't exist|cannot find|error|unable|no todo|appears to be empty|list is empty/);
    }).toPass({ timeout: 15000, intervals: [1000] });

    // Verify we got a response (didn't hang)
    const finalResponse = await page.getByTestId('chat-message-assistant').last().textContent();
    console.log('Final AI Response:', finalResponse?.substring(0, 100));
    expect(finalResponse).toBeTruthy();
    expect(finalResponse!.length).toBeGreaterThan(0);
  });

  test('tool returns error result when trying to delete non-existent todo', async ({ page }) => {
    // Open AI chat
    const aiButton = page.getByTestId('ai-button');
    await aiButton.click();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

    // Ask AI to delete a todo that doesn't exist
    const chatInput = page.getByTestId('chat-input');
    await chatInput.fill('Delete todo with id 999');

    const sendButton = page.getByTestId('chat-send-button');
    await sendButton.click();

    // AI should respond within reasonable time, not hang
    // Wait for response by checking for new messages
    await page.waitForTimeout(2000);
    const messages = page.getByTestId('chat-message-content');
    await expect(messages.last()).toBeVisible({ timeout: 30000 });

    // Check that the response mentions the error
    const pageContent = await page.content();
    expect(pageContent).toMatch(/not found|doesn't exist|cannot find|no todo/i);
  });

  test('multiple operations: add, delete manually, add again, AI deletes', async ({ page }) => {
    // Open AI chat
    const aiButton = page.getByTestId('ai-button');
    await aiButton.click();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

    const chatInput = page.getByTestId('chat-input');
    const sendButton = page.getByTestId('chat-send-button');
    const closeButton = page.getByTestId('chat-close-button');

    // Add first todo via AI
    await chatInput.fill('Add a todo: Walk the dog');
    await sendButton.click();
    await page.waitForTimeout(2000);
    // Wait for AI response in chat messages (not dropdown title)
    await expect(page.getByTestId('chat-message-assistant')).toBeVisible({ timeout: 30000 });

    // Close chat to access todo list
    await closeButton.click();
    await page.waitForTimeout(500);

    // Delete it manually
    await page.locator('li:has-text("Walk the dog")').locator('button:has-text("Delete")').click();
    // Check that the todo item is not in the todo list
    await expect(page.locator('li:has-text("Walk the dog")')).not.toBeVisible();

    // Reopen chat and add a new todo via AI with similar name
    await aiButton.click();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

    await chatInput.fill('Add a todo: Walk the dog again');
    await sendButton.click();
    await page.waitForTimeout(2000);
    // Wait for AI response in chat messages
    await expect(page.getByTestId('chat-message-assistant').last()).toBeVisible({ timeout: 30000 });

    // Now ask AI to delete it (this one exists)
    await chatInput.fill('Delete the walk the dog todo');
    await sendButton.click();

    // AI might ask for confirmation or delete it
    // Either way, it should respond, not hang
    await page.waitForTimeout(2000);
    await expect(page.getByTestId('chat-message-assistant').last()).toBeVisible({ timeout: 30000 });

    const lastMessage = page.getByTestId('chat-message-content').last();
    const responseText = await lastMessage.textContent();
    console.log('AI Response:', responseText);
    expect(responseText).toBeTruthy();
  });

  test('AI deletes manually-added todo by text match', async ({ page }) => {
    // Regression test: ensures the AI can see and delete todos added manually via the UI.
    // Previously, the AI would say "can't find the item" because state wasn't
    // updated before sending the prompt (only updated when tools changed).

    // Step 1: Add todo manually via the input field
    const todoInput = page.locator('input[placeholder="Add a new todo..."]');
    await todoInput.fill('call mom');
    await page.locator('button:has-text("Add")').click();

    // Verify the todo was added
    await expect(page.locator('li:has-text("call mom")')).toBeVisible();

    // Step 2: Open AI chat and ask to delete the todo
    const aiButton = page.getByTestId('ai-button');
    await aiButton.click();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

    const chatInput = page.getByTestId('chat-input');
    const sendButton = page.getByTestId('chat-send-button');

    await chatInput.fill('Delete "call mom"');
    await sendButton.click();

    // Wait for AI response
    await page.waitForTimeout(2000);
    await expect(page.getByTestId('chat-message-assistant').last()).toBeVisible({ timeout: 30000 });

    // Step 3: Verify the todo was deleted
    // Close chat to see the todo list clearly
    const closeButton = page.getByTestId('chat-close-button');
    await closeButton.click();
    await page.waitForTimeout(500);

    // The todo should be gone
    await expect(page.locator('li:has-text("call mom")')).not.toBeVisible({ timeout: 5000 });
  });
});
