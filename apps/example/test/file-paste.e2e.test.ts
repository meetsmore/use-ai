import { test, expect, type Page } from '@playwright/test';

/**
 * Pasting files into the built-in composer.
 *
 * A real browser is the only place the paste path can be exercised end to end:
 * the clipboard payload, `preventDefault` on the paste, and the image preview
 * (which goes through FileReader) all come from the browser.
 */
test.describe('Paste to attach', () => {
  test.setTimeout(60000);

  /**
   * Pastes a clipboard entry into the composer and reports whether the
   * composer took the paste over.
   */
  const pasteIntoComposer = (
    page: Page,
    clipboard: { fileName?: string; mimeType?: string; text?: string }
  ) =>
    page.evaluate(({ fileName, mimeType, text }) => {
      const transfer = new DataTransfer();

      if (mimeType) {
        // A 1x1 transparent PNG, the smallest stand-in for a screenshot.
        const png = Uint8Array.from(atob(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
        ), (char) => char.charCodeAt(0));
        transfer.items.add(new File([png], fileName ?? '', { type: mimeType }));
      }
      if (text !== undefined) {
        transfer.setData('text/plain', text);
      }

      const input = document.querySelector('[data-testid="chat-input"]');
      if (!input) throw new Error('composer input not found');

      const event = new ClipboardEvent('paste', {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      });
      input.dispatchEvent(event);

      return event.defaultPrevented;
    }, clipboard);

  test.beforeEach(async ({ page }) => {
    // The example server needs a key to start, so the page cannot connect without one.
    if (!process.env.ANTHROPIC_API_KEY) {
      test.skip();
    }

    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await page.getByRole('button', { name: 'File Transformers' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'File Transformers' })).toBeVisible();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 10000 });
  });

  test('attaches a pasted screenshot', async ({ page }) => {
    const prevented = await pasteIntoComposer(page, { fileName: 'screenshot.png', mimeType: 'image/png' });

    // Nothing to insert, so the composer takes the paste over.
    expect(prevented).toBe(true);
    await expect(page.getByTestId('file-chip')).toContainText('screenshot.png', { timeout: 5000 });

    // The paste goes through the same pipeline as the picker, transformer included.
    await expect(page.getByTestId('file-chip-processing')).toBeVisible({ timeout: 2000 });
    await expect(page.getByTestId('file-chip-processing')).toBeHidden({ timeout: 10000 });
  });

  test('keeps the text insertion when the clipboard carries text too', async ({ page }) => {
    const prevented = await pasteIntoComposer(page, {
      fileName: 'cell.png',
      mimeType: 'image/png',
      text: 'Revenue: 1200',
    });

    expect(prevented).toBe(false);
    await expect(page.getByTestId('file-chip')).toBeVisible({ timeout: 5000 });
  });

  test('labels a screenshot the browser gave no name', async ({ page }) => {
    await pasteIntoComposer(page, { mimeType: 'image/png' });

    await expect(page.getByTestId('file-chip')).toContainText('pasted-image.png', { timeout: 5000 });
  });

  test('shows why an unaccepted file was rejected', async ({ page }) => {
    await pasteIntoComposer(page, { fileName: 'archive.zip', mimeType: 'application/zip' });

    await expect(page.getByTestId('file-error')).toContainText('application/zip', { timeout: 5000 });
    await expect(page.getByTestId('file-chip')).toHaveCount(0);
  });

  test('does nothing when the clipboard carries only text', async ({ page }) => {
    const prevented = await pasteIntoComposer(page, { text: 'just text' });

    expect(prevented).toBe(false);
    await expect(page.getByTestId('file-chip')).toHaveCount(0);
  });
});
