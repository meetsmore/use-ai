import { test, expect } from '@playwright/test';
import { setupAutoApprove } from './test-helpers';

/**
 * E2E test for OpenAI reasoning model support.
 *
 * Requires:
 * - OPENAI_API_KEY or AI_GATEWAY_API_KEY set in environment (so GPT agent is available)
 * - USE_AI_OPENAI_REASONING_EFFORT set (e.g. 'low') to enable reasoning on the server
 * - USE_AI_OPENAI_REASONING_SUMMARY set (e.g. 'detailed') to stream reasoning text
 *
 * Run with:
 *   USE_AI_OPENAI_REASONING_EFFORT=low USE_AI_OPENAI_REASONING_SUMMARY=detailed bun run test:e2e -- test/openai-reasoning.e2e.test.ts
 */
test.describe('OpenAI Reasoning', () => {
  test.setTimeout(120000);

  test.beforeEach(async ({ page }) => {
    if (!process.env.USE_AI_OPENAI_REASONING_EFFORT) {
      console.log('Skipping OpenAI reasoning E2E: USE_AI_OPENAI_REASONING_EFFORT not set');
      test.skip();
    }
    if (!process.env.OPENAI_API_KEY && !process.env.AI_GATEWAY_API_KEY) {
      console.log('Skipping OpenAI reasoning E2E: no OpenAI API key or AI Gateway key set');
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
   * Helper to select the GPT agent from the dropdown.
   * Skips the test if the agent selector is not visible (only one agent configured).
   */
  async function selectGptAgent(page: import('@playwright/test').Page) {
    const aiButton = page.getByTestId('ai-button');
    await expect(aiButton).toBeVisible({ timeout: 10000 });
    await aiButton.click();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

    // Wait for agent info from server
    await page.waitForTimeout(1500);

    const agentSelector = page.getByTestId('agent-selector');
    if (!await agentSelector.isVisible()) {
      test.skip(true, 'Only one agent configured — cannot select GPT');
      return;
    }

    await agentSelector.click();
    await page.waitForTimeout(100);
    const gptOption = page.getByTestId('agent-option').filter({ hasText: 'ChatGPT' });
    if (!await gptOption.isVisible()) {
      test.skip(true, 'GPT agent not available');
      return;
    }
    await gptOption.click();
    await page.waitForTimeout(300);
  }

  test('multi-turn conversation with reasoning: reasoning is displayed and second turn succeeds', async ({ page }) => {
    await selectGptAgent(page);

    const input = page.getByTestId('chat-input');

    // --- Turn 1: trigger reasoning ---
    await input.fill('What is 15 * 23? Think step by step.');
    await input.press('Enter');

    // Wait for thinking toggle (reasoning stream)
    const thinkingToggle = page.getByTestId('thinking-toggle');
    await expect(thinkingToggle).toBeVisible({ timeout: 45000 });

    // Wait for assistant response to complete
    await expect(async () => {
      const msgs = await page.getByTestId('chat-message-assistant').all();
      expect(msgs.length).toBeGreaterThanOrEqual(1);
    }).toPass({ timeout: 60000, intervals: [1000] });
    await expect(page.locator('.dots')).toBeHidden({ timeout: 60000 });

    // Verify the answer contains 345
    const firstResponse = page.getByTestId('chat-message-assistant').first();
    await expect(firstResponse).toContainText('345');

    // Verify reasoning timeline is visible (thinking toggle appeared during or after response)
    await expect(page.getByTestId('thinking-timeline')).toBeVisible();

    // Verify reasoning parts with encrypted value are persisted in localStorage.
    // The encrypted value (reasoningEncryptedContent + itemId) is critical for multi-turn.
    const storedAfterTurn1 = await page.evaluate(() => {
      const indexJson = localStorage.getItem('use-ai:chat-index');
      if (!indexJson) return null;
      const ids = JSON.parse(indexJson);
      const chatJson = localStorage.getItem(`use-ai:chat:${ids[0]}`);
      if (!chatJson) return null;
      const chat = JSON.parse(chatJson);
      const assistant = chat.messages.find(
        (m: any) => m.role === 'assistant' && m.reasoningParts?.length > 0
      );
      if (!assistant) return null;
      return {
        partsCount: assistant.reasoningParts.length,
        hasEncryptedValue: assistant.reasoningParts.some((p: any) => !!p.encryptedValue),
        // Check that encrypted value contains OpenAI-specific fields
        encryptedValueSample: assistant.reasoningParts.find((p: any) => p.encryptedValue)?.encryptedValue ?? null,
      };
    });

    expect(storedAfterTurn1).not.toBeNull();
    expect(storedAfterTurn1!.partsCount).toBeGreaterThanOrEqual(1);
    expect(storedAfterTurn1!.hasEncryptedValue).toBe(true);

    // Verify the encrypted value contains OpenAI reasoning context (reasoningEncryptedContent + itemId)
    const encryptedValue = JSON.parse(storedAfterTurn1!.encryptedValueSample!);
    expect(encryptedValue.openai).toBeDefined();
    expect(encryptedValue.openai.reasoningEncryptedContent).toBeTruthy();
    expect(encryptedValue.openai.itemId).toBeTruthy();

    // --- Turn 2: follow-up referencing the first answer ---
    // This proves the reasoning signature/itemId was correctly preserved for multi-turn context.
    // If the signature or itemId were missing/malformed, the OpenAI API would reject the request.
    await input.fill('Now double that result.');
    await input.press('Enter');

    // Wait for second assistant response
    await expect(async () => {
      const msgs = await page.getByTestId('chat-message-assistant').all();
      expect(msgs.length).toBeGreaterThanOrEqual(2);
    }).toPass({ timeout: 60000, intervals: [1000] });
    await expect(page.locator('.dots')).toBeHidden({ timeout: 60000 });

    // The second response should contain 690 (345 * 2)
    const secondResponse = page.getByTestId('chat-message-assistant').last();
    await expect(secondResponse).toContainText('690');
  });
});
