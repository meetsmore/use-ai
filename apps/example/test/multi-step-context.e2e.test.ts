import { test, expect } from '@playwright/test';
import { setupAutoApprove } from './test-helpers';

/**
 * E2E tests for multi-step tool call context preservation.
 *
 * Bug: When the AI uses tools in a multi-step run (e.g., search → not found → retry),
 * the conversation context saved to localStorage loses per-step boundaries. After page
 * reload, the LLM receives a malformed history where:
 * - All tool calls from all steps are merged into one assistant message
 * - All text from all steps is concatenated into a separate assistant message
 * - The association between text and tool calls per step is lost
 *
 * This causes the LLM to misunderstand what happened in previous turns.
 */
test.describe('Multi-step tool call context preservation', () => {
  test.setTimeout(60000);

  test.beforeAll(() => {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log('Skipping E2E tests: ANTHROPIC_API_KEY not set');
    }
  });

  test.beforeEach(async ({ page }) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      test.skip();
    }

    await setupAutoApprove(page);

    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
    });
    await page.reload();

    await page.click('text=Todo List');
    await expect(page.locator('h1:has-text("Todo List")')).toBeVisible();
  });

  test('should preserve tool call context correctly after page reload with multi-step interaction', async ({ page }) => {
    // This test exercises the full cycle:
    // 1. User asks AI to add a todo (triggers tool call)
    // 2. AI executes the addTodo tool (multi-step: text + tool_call + tool_result + text)
    // 3. Page reloads (server session lost, client reloads from localStorage)
    // 4. User asks a follow-up question referencing the first action
    // 5. AI should correctly understand context and respond appropriately
    //
    // If the context is lost/malformed, the AI will either:
    // - Hallucinate (making up what happened)
    // - Fail to understand the follow-up
    // - The server may reject with "tool_use ids without tool_result blocks" errors

    // Open AI chat
    const aiButton = page.getByTestId('ai-button');
    await aiButton.click();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

    const chatInput = page.getByTestId('chat-input');
    const sendButton = page.getByTestId('chat-send-button');
    const closeButton = page.getByTestId('chat-close-button');

    // Step 1: Add a todo via AI (triggers tool call)
    console.log('[Test] Step 1: Adding todo via AI');
    await chatInput.fill('add a todo: buy milk');
    await sendButton.click();

    // Wait for AI response (tool execution + text response)
    await expect(async () => {
      const messages = await page.getByTestId('chat-message-assistant').all();
      expect(messages.length).toBeGreaterThan(0);
    }).toPass({ timeout: 30000, intervals: [1000] });

    // Verify todo was actually added
    await closeButton.click();
    await page.waitForTimeout(500);
    await expect(page.locator('li:has-text("buy milk")')).toBeVisible();

    // Step 2: Inspect localStorage to verify per-step message structure
    console.log('[Test] Step 2: Inspecting localStorage message structure');
    const messageStructure = await page.evaluate(() => {
      const index = localStorage.getItem('use-ai:chat-index');
      if (!index) return null;
      const ids = JSON.parse(index);
      const chatId = ids[ids.length - 1];
      const chatData = localStorage.getItem(`use-ai:chat:${chatId}`);
      if (!chatData) return null;
      const chat = JSON.parse(chatData);

      return chat.messages.map((msg: { role: string; content: string; toolCalls?: unknown[]; toolCallId?: string }) => ({
        role: msg.role,
        hasContent: msg.content !== '' && msg.content !== undefined,
        contentPreview: typeof msg.content === 'string' ? msg.content.substring(0, 50) : 'non-string',
        hasToolCalls: Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0,
        toolCallCount: Array.isArray(msg.toolCalls) ? msg.toolCalls.length : 0,
        hasToolCallId: !!msg.toolCallId,
      }));
    });

    console.log('[Test] Message structure:', JSON.stringify(messageStructure, null, 2));

    // Verify we have messages saved
    expect(messageStructure).not.toBeNull();
    expect(messageStructure!.length).toBeGreaterThan(2);

    // Find assistant messages with tool calls
    const assistantWithToolCalls = messageStructure!.filter(
      (m: { role: string; hasToolCalls: boolean }) => m.role === 'assistant' && m.hasToolCalls
    );

    // CRITICAL CHECK: assistant messages with toolCalls should also have content
    // (In the bug, content is empty '' because text is in a separate message)
    for (const msg of assistantWithToolCalls) {
      console.log('[Test] Assistant with tool calls:', msg);
      expect(msg.hasContent).toBe(true);
    }

    // Step 3: Reload page and resume conversation
    console.log('[Test] Step 3: Reloading page');
    await page.reload();
    await expect(page.locator('h1:has-text("Todo List")')).toBeVisible();

    // Reopen chat
    await aiButton.click();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

    // Wait for previous messages to load
    await page.waitForTimeout(1000);

    // Verify previous messages are displayed
    const userMsgCount = await page.getByTestId('chat-message-user').count();
    const assistantMsgCount = await page.getByTestId('chat-message-assistant').count();
    console.log('[Test] Messages after reload:', { user: userMsgCount, assistant: assistantMsgCount });
    expect(userMsgCount).toBeGreaterThan(0);
    expect(assistantMsgCount).toBeGreaterThan(0);

    // Step 4: Send a follow-up that depends on correct context
    console.log('[Test] Step 4: Sending follow-up message');
    await chatInput.fill('what did I just ask you to do?');
    await sendButton.click();

    // Step 5: Verify AI correctly understands the context
    await expect(async () => {
      const messages = await page.getByTestId('chat-message-assistant').all();
      expect(messages.length).toBeGreaterThan(assistantMsgCount);

      const lastMessage = await messages[messages.length - 1].textContent();
      console.log(`[Test] AI response: ${lastMessage?.substring(0, 200)}`);

      // AI should reference the todo/milk action from the first turn
      // This proves it has the correct context
      const mentionsTodo = lastMessage?.toLowerCase().match(/todo|milk|buy|add|grocery/);
      expect(mentionsTodo).toBeTruthy();
    }).toPass({ timeout: 30000, intervals: [2000] });
  });

  test('should not produce tool_use_id errors after reload with multi-step history', async ({ page }) => {
    // This test specifically checks for the Anthropic API error:
    // "tool_use ids were found without tool_result blocks"
    // which occurs when the conversation history has tool_use messages
    // but the corresponding tool_result blocks are missing or mismatched.

    const aiButton = page.getByTestId('ai-button');
    await aiButton.click();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

    const chatInput = page.getByTestId('chat-input');
    const sendButton = page.getByTestId('chat-send-button');

    // Send a message that triggers tool use
    await chatInput.fill('add a todo: test item for context');
    await sendButton.click();

    // Wait for complete response
    await expect(async () => {
      const messages = await page.getByTestId('chat-message-assistant').all();
      expect(messages.length).toBeGreaterThan(0);
    }).toPass({ timeout: 30000, intervals: [1000] });

    // Reload
    await page.reload();
    await expect(page.locator('h1:has-text("Todo List")')).toBeVisible();

    // Reopen chat
    await aiButton.click();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(1000);

    // Listen for console errors that would indicate tool_use_id mismatch
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Send follow-up (this reconstructs history from localStorage and sends to server)
    await chatInput.fill('how many todos are there?');
    await sendButton.click();

    // Wait for response - should succeed without error
    await expect(async () => {
      const messages = await page.getByTestId('chat-message-assistant').all();
      // Should have at least 2 assistant messages (original + follow-up)
      expect(messages.length).toBeGreaterThanOrEqual(2);
    }).toPass({ timeout: 30000, intervals: [2000] });

    // Check that no tool_use_id errors were logged
    const toolUseErrors = consoleErrors.filter(e =>
      e.includes('tool_use') || e.includes('tool_result') || e.includes('400')
    );
    if (toolUseErrors.length > 0) {
      console.log('[Test] Tool use errors found:', toolUseErrors);
    }
    expect(toolUseErrors.length).toBe(0);
  });
});
