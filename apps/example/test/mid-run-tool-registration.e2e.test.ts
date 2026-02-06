import { test, expect } from '@playwright/test';

/**
 * This test verifies that tools registered mid-run (during AI execution) are visible
 * to the AI before the run completes.
 *
 * Current behavior (bug): When the AI navigates to a new page, the new page's tools
 * are not visible until the AI run ends. This prevents the AI from completing tasks
 * that span multiple pages in a single prompt.
 *
 * Expected behavior: Tools should become available to the AI as soon as the
 * corresponding component mounts, even during an active run.
 */
test.describe('Mid-run Tool Registration', () => {
  test.setTimeout(90000);

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

  test('should be able to navigate and use calculate tool on Calculator page in single prompt', async ({ page }) => {
    // Start on the Todo page
    await page.click('text=Todo');
    await expect(page.locator('h1:has-text("Todo List")')).toBeVisible();

    // Open AI chat
    const aiButton = page.getByTestId('ai-button');
    await expect(aiButton).toBeVisible({ timeout: 10000 });
    await aiButton.click();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

    // Ask AI to navigate to Calculator AND perform a calculation in one prompt
    // This tests whether tools become available mid-run after navigation
    // NOTE: We use a complex expression that's hard to compute mentally,
    // forcing the AI to actually use the calculate tool
    const chatInput = page.getByTestId('chat-input');
    await chatInput.fill(
      'Navigate to the Calculator page, then use the calculate tool with the expression "((123 + 456) * 789) / 3" and tell me what result appears in the calculator display.'
    );

    const sendButton = page.getByTestId('chat-send-button');
    await sendButton.click();

    // Wait for the user message to appear
    await expect(
      page.locator('[data-testid="chat-message-user"]').filter({
        hasText: 'navigate to the Calculator',
      })
    ).toBeVisible({ timeout: 5000 });

    // Wait for navigation to happen - Calculator page should be visible
    await expect(page.locator('h1:has-text("Calculator")')).toBeVisible({ timeout: 30000 });

    // Wait for the AI to finish processing
    // Give time for the AI to attempt using the calculate tool
    await page.waitForTimeout(10000);

    // The key assertion: Check if the calculate tool was actually executed
    // by verifying the Calculator's display is NOT the default "0"
    // (AI may calculate a different expression than what we asked for)
    const calculatorDisplay = page.getByTestId('calculator-display');
    await expect(calculatorDisplay).toBeVisible();

    // This assertion will FAIL if the calculate tool wasn't available mid-run
    // because the display will still show "0"
    // We check that it's NOT "0" to confirm some calculation was performed
    const displayText = await calculatorDisplay.textContent();
    expect(displayText).not.toBe('0');
  });

  test('should be able to navigate and use addTodo tool on Todo page in single prompt', async ({ page }) => {
    // Start on the Calculator page
    await page.click('text=Calculator');
    await expect(page.locator('h1:has-text("Calculator")')).toBeVisible();

    // Open AI chat
    const aiButton = page.getByTestId('ai-button');
    await expect(aiButton).toBeVisible({ timeout: 10000 });
    await aiButton.click();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

    // Ask AI to navigate to Todo page and add a todo item
    // Phrase it as a direct action request that requires the tool to be called
    const chatInput = page.getByTestId('chat-input');
    await chatInput.fill(
      'Navigate to the Todo page and add "Buy milk 12345" to my todo list using the addTodo tool, then confirm it was added by telling me the ID number of the new todo.'
    );

    const sendButton = page.getByTestId('chat-send-button');
    await sendButton.click();

    // Wait for the user message
    await expect(
      page.locator('[data-testid="chat-message-user"]').filter({
        hasText: 'Navigate to the Todo page',
      })
    ).toBeVisible({ timeout: 5000 });

    // Wait for navigation - Todo page should appear
    await expect(page.locator('h1:has-text("Todo List")')).toBeVisible({ timeout: 30000 });

    // Wait for the AI to finish processing
    await page.waitForTimeout(10000);

    // The key assertion: Check if the addTodo tool was actually executed
    // by verifying the todo item appears in the Todo list
    const todoList = page.getByTestId('todo-list');

    // This assertion will FAIL if the addTodo tool wasn't available mid-run
    // because there will be no todo items in the list
    // NOTE: AI may paraphrase the text, so we just check that a todo exists
    const todoItem = todoList.getByTestId('todo-item').first();
    await expect(todoItem).toBeVisible({ timeout: 5000 });
  });
});
