import { test, expect } from '@playwright/test';

test.describe('Suggestions System', () => {
  test.setTimeout(45000);

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
  });

  test('should display up to 4 randomly selected suggestions in empty chat', async ({ page }) => {
    // Navigate to Todo page which has suggestions
    await page.click('text=Todo List');
    await expect(page.locator('h1:has-text("Todo List")')).toBeVisible();

    // Open AI chat
    const aiButton = page.getByTestId('ai-button');
    await expect(aiButton).toBeVisible({ timeout: 10000 });
    await aiButton.click();

    // Wait for chat panel to open
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

    // Check that suggestions are displayed in empty chat
    // The TodoList has 2 suggestions defined, so we should see both
    const suggestionButtons = page.locator('[data-testid="chat-suggestion-button"]');

    // Wait for suggestions to appear (may take longer in React 16 due to different batching)
    await expect(suggestionButtons.first()).toBeVisible({ timeout: 5000 });
    const count = await suggestionButtons.count();

    // Should have at least 1 suggestion, max 4 (but TodoList only has 2)
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(4);

    // Verify the suggestions are from TodoList
    const firstSuggestion = suggestionButtons.first();
    await expect(firstSuggestion).toBeVisible();

    // Check that at least one of the TodoList suggestions is visible
    const todoSuggestion1 = page.locator('[data-testid="chat-suggestion-button"]:has-text("Add a todo to buy groceries")');
    const todoSuggestion2 = page.locator('[data-testid="chat-suggestion-button"]:has-text("Create a shopping list for dinner")');

    // At least one should be visible
    const suggestion1Visible = await todoSuggestion1.isVisible();
    const suggestion2Visible = await todoSuggestion2.isVisible();
    expect(suggestion1Visible || suggestion2Visible).toBe(true);
  });

  test('should send message when suggestion is clicked', async ({ page }) => {
    // Navigate to Todo page
    await page.click('text=Todo List');
    await expect(page.locator('h1:has-text("Todo List")')).toBeVisible();

    // Open AI chat
    const aiButton = page.getByTestId('ai-button');
    await aiButton.click();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

    // Wait for suggestions to appear and be interactive
    const suggestionButton = page.locator('[data-testid="chat-suggestion-button"]').first();
    await expect(suggestionButton).toBeVisible({ timeout: 5000 });
    await expect(suggestionButton).toBeEnabled();

    // Get the suggestion text before clicking
    const suggestionText = await suggestionButton.textContent();
    expect(suggestionText).toBeTruthy();

    // Click the suggestion
    await suggestionButton.click();

    // Wait for the message to appear in the chat (with longer timeout)
    const userMessage = page.locator('[data-testid="chat-message-user"]').filter({ hasText: suggestionText! });
    await expect(userMessage).toBeVisible({ timeout: 10000 });

    // Verify suggestions are no longer visible (chat is no longer empty)
    const suggestionsAfterClick = page.locator('[data-testid="chat-suggestion-button"]');
    await expect(suggestionsAfterClick).toHaveCount(0);
  });

  test('should not display suggestions when chat has messages', async ({ page }) => {
    // Navigate to Todo page
    await page.click('text=Todo List');
    await expect(page.locator('h1:has-text("Todo List")')).toBeVisible();

    // Open AI chat
    const aiButton = page.getByTestId('ai-button');
    await aiButton.click();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

    // Verify suggestions are visible initially
    const suggestionsBefore = page.locator('[data-testid="chat-suggestion-button"]');
    await expect(suggestionsBefore.first()).toBeVisible({ timeout: 5000 });

    // Send a message manually
    const chatInput = page.getByTestId('chat-input');
    await chatInput.fill('Add a todo to test suggestions');

    const sendButton = page.getByTestId('chat-send-button');
    await sendButton.click();

    // Wait for the message to appear
    await expect(page.locator('[data-testid="chat-message-user"]').first()).toBeVisible({ timeout: 5000 });

    // Suggestions should no longer be visible
    await expect(suggestionsBefore).toHaveCount(0);
  });

  test('should display suggestions again after creating new chat', async ({ page }) => {
    // Navigate to Todo page
    await page.click('text=Todo List');
    await expect(page.locator('h1:has-text("Todo List")')).toBeVisible();

    // Open AI chat
    const aiButton = page.getByTestId('ai-button');
    await aiButton.click();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

    // Send a message to make chat non-empty
    const chatInput = page.getByTestId('chat-input');
    await chatInput.fill('Test message');
    const sendButton = page.getByTestId('chat-send-button');
    await sendButton.click();

    // Wait for message to appear
    await expect(page.locator('[data-testid="chat-message-user"]').first()).toBeVisible({ timeout: 5000 });

    // Verify no suggestions
    const suggestionsAfterMessage = page.locator('[data-testid="chat-suggestion-button"]');
    await expect(suggestionsAfterMessage).toHaveCount(0);

    // Create new chat
    const newChatButton = page.getByTestId('new-chat-button');
    await newChatButton.click();

    // Suggestions should reappear in the new empty chat
    const suggestionsInNewChat = page.locator('[data-testid="chat-suggestion-button"]');
    await expect(suggestionsInNewChat.first()).toBeVisible({ timeout: 5000 });
    await expect(suggestionsInNewChat).toHaveCount(2);
  });

  test('should only show suggestions from current page after navigation', async ({ page }) => {
    // This test verifies that when navigating between pages, suggestions from
    // unmounted components are properly cleaned up.
    //
    // Bug scenario:
    // 1. Navigate to Todo page (has 2 suggestions)
    // 2. Open chat UI - see TodoList suggestions
    // 3. Close chat UI
    // 4. Navigate to Calculator page (has 1 suggestion)
    // 5. Open chat UI
    // Expected: Only Calculator suggestion ("What's 17 x 410?")
    // Actual (before fix): Mix of TodoList and Calculator suggestions

    // Step 1: Navigate to Todo page
    await page.click('text=Todo List');
    await expect(page.locator('h1:has-text("Todo List")')).toBeVisible();

    // Step 2: Open AI chat and verify TodoList suggestions
    const aiButton = page.getByTestId('ai-button');
    await expect(aiButton).toBeVisible({ timeout: 10000 });
    await aiButton.click();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

    // Wait for suggestions to appear
    const suggestionButtons = page.locator('[data-testid="chat-suggestion-button"]');
    await expect(suggestionButtons.first()).toBeVisible({ timeout: 5000 });

    // Verify TodoList suggestions are shown (it has 2 suggestions)
    const todoSuggestion1 = page.locator('[data-testid="chat-suggestion-button"]:has-text("Add a todo to buy groceries")');
    const todoSuggestion2 = page.locator('[data-testid="chat-suggestion-button"]:has-text("Create a shopping list for dinner")');
    expect(await todoSuggestion1.isVisible() || await todoSuggestion2.isVisible()).toBe(true);

    // Step 3: Close chat UI
    const closeButton = page.getByTestId('chat-close-button');
    await closeButton.click();
    await expect(page.getByTestId('chat-input')).not.toBeVisible({ timeout: 5000 });

    // Step 4: Navigate to Calculator page
    await page.click('text=Calculator');
    await expect(page.locator('h1:has-text("Calculator")')).toBeVisible();

    // Step 5: Open chat UI again
    await aiButton.click();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

    // Wait for suggestions to appear
    await expect(suggestionButtons.first()).toBeVisible({ timeout: 5000 });

    // Step 6: Verify ONLY Calculator suggestion is shown
    // Calculator has 1 suggestion: "What's 17 x 410?"
    const calculatorSuggestion = page.locator('[data-testid="chat-suggestion-button"]:has-text("17 x 410")');
    await expect(calculatorSuggestion).toBeVisible({ timeout: 5000 });

    // Verify TodoList suggestions are NOT shown (they should have been cleaned up)
    const staleToDoSuggestion1 = page.locator('[data-testid="chat-suggestion-button"]:has-text("Add a todo to buy groceries")');
    const staleToDoSuggestion2 = page.locator('[data-testid="chat-suggestion-button"]:has-text("Create a shopping list for dinner")');

    await expect(staleToDoSuggestion1).not.toBeVisible();
    await expect(staleToDoSuggestion2).not.toBeVisible();

    // Should only have exactly 1 suggestion (the Calculator one)
    const finalSuggestionCount = await suggestionButtons.count();
    expect(finalSuggestionCount).toBe(1);
  });
});
