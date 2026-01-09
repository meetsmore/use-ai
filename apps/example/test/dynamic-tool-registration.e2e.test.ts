import { test, expect } from '@playwright/test';

test.describe('Dynamic Tool Registration', () => {
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

    // Navigate to the multi-list page
    await page.goto('/');
    await page.click('text=Multi-List');

    // Wait for the page to load
    await expect(page.locator('h1:has-text("Multiple List Items Test")')).toBeVisible();
  });

  test('BUG FIX: Repeated messages with same content are not deduplicated', async ({ page }) => {
    // This test reproduces a bug where sending the same message twice (e.g., "increment the counter")
    // would cause the second instance to be incorrectly filtered out as a duplicate.
    //
    // Root cause: Server was using content-based deduplication instead of position-based.
    // When the second "increment the counter" was sent, it matched an earlier message's content
    // and was filtered out, leaving the conversation ending with an assistant message.
    // Claude then returned an empty response because there was no new user message.
    //
    // Repro steps:
    // 1. Delete all items
    // 2. Create Item-Z via AI
    // 3. Send "increment the counter" (works)
    // 4. Create Item-Y via AI
    // 5. Send "increment the counter" again (bug: was being deduplicated)
    //
    // Fix: Changed from content-based to position-based deduplication.
    // Now we count existing user messages and only append messages beyond that count.

    // First, delete all existing items manually
    console.log('[Test] Deleting all existing items...');
    const deleteButtons = page.locator('button[title="Delete this item"]');
    const count = await deleteButtons.count();
    for (let i = 0; i < count; i++) {
      // Always click the first one since indices shift after deletion
      await deleteButtons.first().click();
      await page.waitForTimeout(200);
    }

    // Verify all items are deleted
    await expect(deleteButtons).toHaveCount(0);
    console.log('[Test] All items deleted');

    // Open AI chat
    console.log('[Test] Opening AI chat...');
    const aiButton = page.getByTestId('ai-button');
    await expect(aiButton).toBeVisible({ timeout: 10000 });
    await aiButton.click();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

    const chatInput = page.getByTestId('chat-input');
    const sendButton = page.getByTestId('chat-send-button');

    // Step 2: Create Item-Z
    console.log('[Test] Creating Item-Z...');
    await chatInput.fill('create a new list item: Item-Z');
    await sendButton.click();

    // Wait for AI response
    await page.waitForTimeout(2000);
    await expect(page.getByTestId('chat-message-assistant').last()).toBeVisible({ timeout: 30000 });
    console.log('[Test] Item-Z created');

    // Verify Item-A was created (system assigns letter IDs)
    await expect(page.locator('h3:has-text("Item-A")').first()).toBeVisible();

    // Step 3: Increment counter (should work - only one item)
    console.log('[Test] Incrementing counter (first time - should work)...');
    await chatInput.fill('increment the counter');
    await sendButton.click();

    // Wait for AI response
    await page.waitForTimeout(2000);
    await expect(page.getByTestId('chat-message-assistant').last()).toBeVisible({ timeout: 30000 });
    console.log('[Test] Counter incremented successfully');

    // Step 4: Create Item-Y
    console.log('[Test] Creating Item-Y...');
    await chatInput.fill('create another list item: Item-Y');
    await sendButton.click();

    // Wait for AI response
    await page.waitForTimeout(2000);
    await expect(page.getByTestId('chat-message-assistant').last()).toBeVisible({ timeout: 30000 });
    console.log('[Test] Item-Y created');

    // Verify Item-B was created
    await expect(page.locator('h3:has-text("Item-B")').first()).toBeVisible();

    // Step 5: Increment counter (BUG: was being deduplicated, causing hang)
    console.log('[Test] Incrementing counter (second time - testing repeated message handling)...');
    const messageCountBefore = await page.getByTestId('chat-message-assistant').count();
    console.log('[Test] Message count before:', messageCountBefore);

    await chatInput.fill('increment the counter');
    await sendButton.click();

    // CRITICAL: This should NOT hang
    // With the fix, the repeated "increment the counter" message is properly added to history
    // Claude receives it and can respond (asking for clarification or picking an item)
    console.log('[Test] Waiting for AI response (should not hang with fix)...');
    await page.waitForTimeout(3000);

    // Check for new message - if this times out, the bug is reproduced
    await expect(async () => {
      const messageCountAfter = await page.getByTestId('chat-message-assistant').count();
      console.log('[Test] Message count after:', messageCountAfter);
      expect(messageCountAfter).toBeGreaterThan(messageCountBefore);
    }).toPass({ timeout: 30000, intervals: [2000] });

    // Verify we got a response (didn't hang)
    const finalResponse = await page.getByTestId('chat-message-assistant').last().textContent();
    console.log('[Test] Final AI Response:', finalResponse?.substring(0, 150));
    expect(finalResponse).toBeTruthy();
    expect(finalResponse!.length).toBeGreaterThan(0);
  });

  test('dynamically created items have tools immediately available', async ({ page }) => {
    // This test verifies that when a new item is created via AI,
    // its tools are immediately available for the next AI request.

    // Delete all existing items
    const deleteButtons = page.locator('button[title="Delete this item"]');
    const count = await deleteButtons.count();
    for (let i = 0; i < count; i++) {
      await deleteButtons.first().click();
      await page.waitForTimeout(200);
    }

    // Open AI chat
    const aiButton = page.getByTestId('ai-button');
    await aiButton.click();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

    const chatInput = page.getByTestId('chat-input');
    const sendButton = page.getByTestId('chat-send-button');

    // Create an item
    await chatInput.fill('create a new item called "Test Item"');
    await sendButton.click();
    await page.waitForTimeout(2000);
    await expect(page.getByTestId('chat-message-assistant').last()).toBeVisible({ timeout: 30000 });

    // Immediately ask to update the newly created item's label
    // This should work if tools are registered immediately
    await chatInput.fill('change Item-A label to "Updated Label"');
    await sendButton.click();
    await page.waitForTimeout(2000);
    await expect(page.getByTestId('chat-message-assistant').last()).toBeVisible({ timeout: 30000 });

    // Verify the label was updated
    await expect(page.locator('text=Updated Label')).toBeVisible();
  });
});
