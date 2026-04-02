import { test, expect } from '@playwright/test';

test.describe('MCP Tool Error Recovery', () => {
  // This test verifies that when an MCP tool execution throws an error,
  // the tool_result is still persisted in conversation history.
  // Without the fix, the missing tool_result causes Anthropic API errors
  // on the next turn: "tool_use ids were found without tool_result blocks"
  test.setTimeout(90000);

  test.beforeAll(async () => {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log('Skipping E2E tests: ANTHROPIC_API_KEY environment variable not set');
      return;
    }
    console.log('Using MCP server on http://localhost:3002');
  });

  test.beforeEach(async ({ page }) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      test.skip();
    }

    // Clear localStorage and navigate to remote MCP tools page
    await page.goto('/');
    await page.evaluate(() => { localStorage.clear(); });
    await page.reload();
    await page.click('text=Remote MCP Tools');
    await expect(page.locator('h1:has-text("Remote MCP Tools Test")')).toBeVisible();
  });

  test('conversation continues on next turn after MCP tool error', async ({ page }) => {
    // 1. Call an MCP tool that always fails
    // 2. Verify the AI handles the error gracefully
    // 3. Send a follow-up message in the same session
    // 4. Verify no "tool_use without tool_result" error — the follow-up succeeds

    // Open AI chat
    const aiButton = page.getByTestId('ai-button');
    await expect(aiButton).toBeVisible({ timeout: 10000 });
    await aiButton.click();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

    const chatInput = page.getByTestId('chat-input');
    const sendButton = page.getByTestId('chat-send-button');

    // Capture console errors
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    // Step 1: Ask AI to use the always-failing tool
    console.log('[Test] Step 1: Calling always-failing MCP tool');
    await chatInput.fill('Please call the mcp_always_fail tool with message "test error". After the error, tell me what happened.');
    await sendButton.click();

    // Wait for AI to respond (it should handle the tool error gracefully)
    await page.waitForTimeout(3000);
    await expect(async () => {
      const messages = await page.getByTestId('chat-message-assistant').all();
      expect(messages.length).toBeGreaterThan(0);
      const lastMessage = await messages[messages.length - 1].textContent();
      console.log(`[Test] AI response after error: ${lastMessage?.substring(0, 200)}`);
      // AI should acknowledge the error in some way
      expect(lastMessage?.toLowerCase()).toMatch(/error|fail|unable|couldn't|problem|issue/);
    }).toPass({ timeout: 45000, intervals: [2000] });

    // Step 2: Verify localStorage has tool_result for every tool_use
    console.log('[Test] Step 2: Checking localStorage for tool_result completeness');
    const { assistantToolCallIds, toolResultIds } = await page.evaluate(() => {
      const index = localStorage.getItem('use-ai:chat-index');
      if (!index) return { assistantToolCallIds: [] as string[], toolResultIds: [] as string[] };
      const ids = JSON.parse(index);
      if (ids.length === 0) return { assistantToolCallIds: [] as string[], toolResultIds: [] as string[] };
      const chatData = localStorage.getItem(`use-ai:chat:${ids[ids.length - 1]}`);
      if (!chatData) return { assistantToolCallIds: [] as string[], toolResultIds: [] as string[] };
      const chat = JSON.parse(chatData);
      const msgs = chat.messages || [];

      const assistantToolCallIds = msgs
        .filter((m: { role: string; toolCalls?: unknown[] }) => m.role === 'assistant' && m.toolCalls)
        .flatMap((m: { toolCalls: { id: string }[] }) => m.toolCalls.map(tc => tc.id));

      const toolResultIds = msgs
        .filter((m: { role: string }) => m.role === 'tool')
        .map((m: { toolCallId?: string }) => m.toolCallId);

      return { assistantToolCallIds, toolResultIds };
    });

    console.log('[Test] Tool call IDs:', assistantToolCallIds);
    console.log('[Test] Tool result IDs:', toolResultIds);

    // Every tool_use must have a matching tool_result
    const resultSet = new Set(toolResultIds);
    for (const id of assistantToolCallIds) {
      expect(resultSet.has(id)).toBe(true);
    }

    // Step 3: Send follow-up message (fails without the fix because tool_result is missing)
    console.log('[Test] Step 3: Sending follow-up message');
    await chatInput.fill('Now please call the mcp_add tool to add 10 and 20.');
    await sendButton.click();

    await page.waitForTimeout(3000);
    await expect(async () => {
      const messages = await page.getByTestId('chat-message-assistant').all();
      // Should have at least 2 assistant messages (error response + follow-up)
      expect(messages.length).toBeGreaterThanOrEqual(2);
      const lastMessage = await messages[messages.length - 1].textContent();
      console.log(`[Test] Follow-up response: ${lastMessage?.substring(0, 200)}`);
      // AI should have called mcp_add and returned 30
      expect(lastMessage?.toLowerCase()).toMatch(/30|thirty/);
    }).toPass({ timeout: 45000, intervals: [2000] });

    // Verify no tool_use / tool_result errors occurred
    const toolUseErrors = errors.filter(err =>
      err.includes('tool_use') || err.includes('tool_result')
    );
    console.log('[Test] tool_use errors:', toolUseErrors);
    expect(toolUseErrors.length).toBe(0);

    console.log('[Test] SUCCESS: Conversation continued normally after MCP tool error');
  });
});
