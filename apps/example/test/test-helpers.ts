import type { Page } from '@playwright/test';

/**
 * Sets up automatic approval for destructive tool calls.
 * Injects a MutationObserver that auto-clicks the approve button
 * whenever the tool approval dialog appears in the DOM.
 *
 * Uses addInitScript so the observer survives page reloads.
 *
 * Call this once in beforeEach (before navigation) for tests that
 * trigger destructive tools but aren't testing the approval flow.
 */
export async function setupAutoApprove(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Poll for the approve button and click it when found.
    // MutationObserver can fire during React's DOM commit before event
    // handlers are wired up, causing btn.click() to be silently ignored.
    // Polling avoids this race condition.
    setInterval(() => {
      const btn = document.querySelector<HTMLButtonElement>(
        '[data-testid="approve-tool-button"]'
      );
      if (btn) {
        btn.click();
      }
    }, 100);
  });
}
