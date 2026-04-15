import { test, expect } from '@playwright/test';
import { setupAutoApprove } from './test-helpers';

/**
 * E2E test for extended thinking (reasoning) feature.
 *
 * Requires:
 * - ANTHROPIC_API_KEY set in environment
 * - USE_AI_ANTHROPIC_REASONING_BUDGET_TOKEN set to a positive integer (e.g. 10000)
 *   to enable extended thinking on the server
 *
 * Run with:
 *   USE_AI_ANTHROPIC_REASONING_BUDGET_TOKEN=10000 bun run test:e2e -- test/extended-thinking.e2e.test.ts
 */
test.describe('Extended Thinking', () => {
  test.setTimeout(90000);

  test.beforeEach(async ({ page }) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log('Skipping E2E tests: ANTHROPIC_API_KEY not set');
      test.skip();
    }
    if (!Number(process.env.USE_AI_ANTHROPIC_REASONING_BUDGET_TOKEN)) {
      console.log('Skipping extended thinking E2E: USE_AI_ANTHROPIC_REASONING_BUDGET_TOKEN not set');
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

  test('displays thinking timeline when model uses extended thinking', async ({ page }) => {
    // Open AI chat
    const aiButton = page.getByTestId('ai-button');
    await expect(aiButton).toBeVisible({ timeout: 10000 });
    await aiButton.click();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

    // Send a message that will trigger thinking
    const input = page.getByTestId('chat-input');
    await input.fill('What is 15 * 23? Think step by step.');
    await input.press('Enter');

    // Wait for the thinking timeline to appear during streaming
    const thinkingToggle = page.getByTestId('thinking-toggle');
    await expect(thinkingToggle).toBeVisible({ timeout: 30000 });

    // Wait for the response to complete
    await expect(async () => {
      const msgs = await page.getByTestId('chat-message-assistant').all();
      expect(msgs.length).toBeGreaterThanOrEqual(1);
    }).toPass({ timeout: 60000, intervals: [1000] });
    await expect(page.locator('.dots')).toBeHidden({ timeout: 60000 });

    // After completion, the thinking timeline should be present in the persisted message
    const thinkingTimeline = page.getByTestId('thinking-timeline');
    await expect(thinkingTimeline).toBeVisible();

    // The assistant message should contain the answer
    const assistantMessage = page.getByTestId('chat-message-assistant');
    await expect(assistantMessage).toContainText('345');
  });

  test('mock agent: reasoning is streamed, persisted with signature, and displayed in UI', async ({ page }) => {
    // This test uses the mock reasoning model (USE_AI_ENABLE_MOCK_AGENT=true) which is
    // deterministic and requires no API key. It verifies the full reasoning pipeline:
    // streaming → persistence → UI display.
    if (!process.env.USE_AI_ENABLE_MOCK_AGENT) {
      console.log('Skipping mock agent test: USE_AI_ENABLE_MOCK_AGENT not set');
      test.skip();
    }

    // Open AI chat
    const aiButton = page.getByTestId('ai-button');
    await expect(aiButton).toBeVisible({ timeout: 10000 });
    await aiButton.click();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

    // Select mock agent
    const agentSelector = page.getByTestId('agent-selector');
    if (await agentSelector.isVisible()) {
      await agentSelector.click();
      await page.waitForTimeout(100);
      const mockOption = page.getByTestId('agent-option').filter({ hasText: 'Mock' });
      await mockOption.click();
      await page.waitForTimeout(300);
    }

    const input = page.getByTestId('chat-input');
    await input.fill('hello');
    await input.press('Enter');

    // Wait for thinking toggle to appear (reasoning is streaming)
    const thinkingToggle = page.getByTestId('thinking-toggle');
    await expect(thinkingToggle).toBeVisible({ timeout: 15000 });

    // Wait for response to complete
    await expect(async () => {
      const msgs = await page.getByTestId('chat-message-assistant').all();
      expect(msgs.length).toBeGreaterThanOrEqual(1);
    }).toPass({ timeout: 30000, intervals: [500] });
    await expect(page.locator('.dots')).toBeHidden({ timeout: 15000 });

    // Thinking timeline should be visible after completion
    await expect(page.getByTestId('thinking-timeline')).toBeVisible();

    // Verify reasoning parts with mock signature are persisted in localStorage
    const storedData = await page.evaluate(() => {
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
        hasReasoningText: assistant.reasoningParts.some((p: any) => p.text?.length > 0),
        hasSignature: assistant.reasoningParts.some(
          (p: any) => !!p.encryptedValue
        ),
      };
    });

    expect(storedData).not.toBeNull();
    expect(storedData!.hasReasoningText).toBe(true);
    expect(storedData!.hasSignature).toBe(true);
  });

  test('tampered signature causes API error on next turn (proves signature is sent)', async ({ page }) => {
    test.setTimeout(120000);

    // Open AI chat
    const aiButton = page.getByTestId('ai-button');
    await expect(aiButton).toBeVisible({ timeout: 10000 });
    await aiButton.click();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

    const input = page.getByTestId('chat-input');

    // Turn 1: Trigger extended thinking
    await input.fill('Say "hello" and nothing else.');
    await input.press('Enter');

    await expect(async () => {
      const msgs = await page.getByTestId('chat-message-assistant').all();
      expect(msgs.length).toBeGreaterThanOrEqual(1);
    }).toPass({ timeout: 60000, intervals: [1000] });
    await expect(page.locator('.dots')).toBeHidden({ timeout: 60000 });

    // Verify reasoning with signature was persisted
    const hasSignature = await page.evaluate(() => {
      const indexJson = localStorage.getItem('use-ai:chat-index');
      if (!indexJson) return false;
      const ids = JSON.parse(indexJson);
      const chatJson = localStorage.getItem(`use-ai:chat:${ids[0]}`);
      if (!chatJson) return false;
      const chat = JSON.parse(chatJson);
      return chat.messages.some(
        (m: any) => m.role === 'assistant' && m.reasoningParts?.some(
          (p: any) => !!p.encryptedValue
        )
      );
    });
    expect(hasSignature).toBe(true);

    // Tamper with the signature in localStorage
    await page.evaluate(() => {
      const indexJson = localStorage.getItem('use-ai:chat-index');
      if (!indexJson) return;
      const ids = JSON.parse(indexJson);
      const key = `use-ai:chat:${ids[0]}`;
      const chatJson = localStorage.getItem(key);
      if (!chatJson) return;
      const chat = JSON.parse(chatJson);
      for (const m of chat.messages) {
        if (m.role === 'assistant' && m.reasoningParts) {
          for (const rp of m.reasoningParts) {
            if (rp.encryptedValue) {
              rp.encryptedValue = JSON.stringify({ anthropic: { signature: 'TAMPERED_INVALID_SIGNATURE' } });
            }
          }
        }
      }
      localStorage.setItem(key, JSON.stringify(chat));
    });

    // Turn 2: Send follow-up — the tampered signature should cause an API error
    await input.fill('What did you just say?');
    await input.press('Enter');

    // Wait for error response (the API should reject the tampered thinking block)
    await expect(async () => {
      const msgs = await page.getByTestId('chat-message-assistant').all();
      expect(msgs.length).toBeGreaterThanOrEqual(2);
    }).toPass({ timeout: 60000, intervals: [1000] });
    await expect(page.locator('.dots')).toBeHidden({ timeout: 60000 });

    // The error message should mention thinking blocks being modified
    const lastMessage = page.getByTestId('chat-message-assistant').last();
    await expect(lastMessage).toContainText(/thinking|redacted_thinking|cannot be modified|error/i);
  });
});
