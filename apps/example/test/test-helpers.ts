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
    const startObserver = () => {
      const observer = new MutationObserver(() => {
        const btn = document.querySelector<HTMLButtonElement>(
          '[data-testid="approve-tool-button"]'
        );
        if (btn) {
          btn.click();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    };

    if (document.body) {
      startObserver();
    } else {
      document.addEventListener('DOMContentLoaded', startObserver);
    }
  });
}
