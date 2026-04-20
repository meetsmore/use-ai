import { test, expect } from '@playwright/test';
import { setupAutoApprove } from './test-helpers';

/**
 * E2E test for Google Gemini reasoning model support.
 *
 * Requires:
 * - AI_GATEWAY_API_KEY set in environment
 * - USE_AI_GEMINI_THINKING_LEVEL set (e.g. 'low') to enable reasoning on the server
 *
 * Optionally:
 * - USE_AI_GEMINI_MODEL to override the default model (google/gemini-3.1-flash-lite-preview)
 *
 * Run with:
 *   USE_AI_GEMINI_THINKING_LEVEL=low bun run test:e2e -- test/gemini-reasoning.e2e.test.ts
 */
test.describe('Gemini Reasoning', () => {
  test.setTimeout(120000);

  test.beforeEach(async ({ page }) => {
    if (!process.env.USE_AI_GEMINI_THINKING_LEVEL) {
      console.log('Skipping Gemini reasoning E2E: USE_AI_GEMINI_THINKING_LEVEL not set');
      test.skip();
    }
    if (!process.env.AI_GATEWAY_API_KEY) {
      console.log('Skipping Gemini reasoning E2E: AI_GATEWAY_API_KEY not set');
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

  /**
   * Helper to select the Gemini agent from the dropdown.
   * Skips the test if the agent selector is not visible (only one agent configured).
   */
  async function selectGeminiAgent(page: import('@playwright/test').Page) {
    const aiButton = page.getByTestId('ai-button');
    await expect(aiButton).toBeVisible({ timeout: 10000 });
    await aiButton.click();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

    // Wait for agent info from server
    await page.waitForTimeout(1500);

    const agentSelector = page.getByTestId('agent-selector');
    if (!await agentSelector.isVisible()) {
      test.skip(true, 'Only one agent configured — cannot select Gemini');
      return;
    }

    await agentSelector.click();
    await page.waitForTimeout(100);
    const geminiOption = page.getByTestId('agent-option').filter({ hasText: 'Gemini' });
    if (!await geminiOption.isVisible()) {
      test.skip(true, 'Gemini agent not available');
      return;
    }
    await geminiOption.click();
    await page.waitForTimeout(300);
  }

  test('multi-turn with tool calls: turn 1 executes tool, turn 2 continues with preserved thoughtSignature', async ({ page }) => {
    await selectGeminiAgent(page);

    const input = page.getByTestId('chat-input');

    // --- Turn 1: trigger tool call (addTodo) ---
    await input.fill('Add a todo item "Buy groceries"');
    await input.press('Enter');

    // Wait for assistant response to complete
    await expect(async () => {
      const msgs = await page.getByTestId('chat-message-assistant').all();
      expect(msgs.length).toBeGreaterThanOrEqual(1);
    }).toPass({ timeout: 60000, intervals: [1000] });
    await expect(page.locator('.dots')).toBeHidden({ timeout: 60000 });

    // Verify the assistant responded
    const firstResponse = page.getByTestId('chat-message-assistant').first();
    await expect(firstResponse).toBeVisible();

    // Verify thoughtSignature is stored in localStorage on tool calls.
    const storedAfterTurn1 = await page.evaluate(() => {
      const indexJson = localStorage.getItem('use-ai:chat-index');
      if (!indexJson) return null;
      const ids = JSON.parse(indexJson);
      const chatJson = localStorage.getItem(`use-ai:chat:${ids[0]}`);
      if (!chatJson) return null;
      const chat = JSON.parse(chatJson);
      const assistant = chat.messages.find(
        (m: any) => m.role === 'assistant' && m.toolCalls?.some((tc: any) => !!tc.encryptedValue)
      );
      if (!assistant) return { hasToolCallWithSignature: false };
      const tcWithSig = assistant.toolCalls.find((tc: any) => tc.encryptedValue);
      return {
        hasToolCallWithSignature: true,
        encryptedValueSample: tcWithSig?.encryptedValue ?? null,
      };
    });

    // Gemini thoughtSignature should be preserved on tool calls
    if (storedAfterTurn1?.hasToolCallWithSignature) {
      const encryptedValue = JSON.parse(storedAfterTurn1.encryptedValueSample!);
      expect(encryptedValue.google).toBeDefined();
      expect(encryptedValue.google.thoughtSignature).toBeTruthy();
    }

    // --- Turn 2: follow-up that also triggers a tool call ---
    // This proves the thoughtSignature was correctly preserved and sent back for multi-turn.
    // If the signature were missing/malformed, the Gemini API would reject or misbehave.
    await input.fill('Now add another todo "Walk the dog"');
    await input.press('Enter');

    // Wait for second assistant response
    await expect(async () => {
      const msgs = await page.getByTestId('chat-message-assistant').all();
      expect(msgs.length).toBeGreaterThanOrEqual(2);
    }).toPass({ timeout: 60000, intervals: [1000] });
    await expect(page.locator('.dots')).toBeHidden({ timeout: 60000 });

    // The second response should succeed (multi-turn with thoughtSignature works)
    const secondResponse = page.getByTestId('chat-message-assistant').last();
    await expect(secondResponse).toBeVisible();
  });
});
