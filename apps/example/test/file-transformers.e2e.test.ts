import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';

test.describe('File Transformers', () => {
  // Set timeout for all tests in this suite
  test.setTimeout(60000);

  let testPdfPath: string;
  let testImagePath: string;

  test.beforeAll(async () => {
    // Skip all tests if ANTHROPIC_API_KEY is not set
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log('Skipping E2E tests: ANTHROPIC_API_KEY environment variable not set');
      console.log('Set it with: export ANTHROPIC_API_KEY=your_api_key_here');
    }

    // Create temporary test files
    const tempDir = os.tmpdir();

    // Create a simple PDF-like file (for testing purposes, we use a text file with .pdf extension)
    // The transformer doesn't actually parse PDF, it just simulates processing
    testPdfPath = path.join(tempDir, 'test-document.pdf');
    fs.writeFileSync(testPdfPath, '%PDF-1.4\nThis is a test PDF content for E2E testing.\nIt contains sample text.');

    // Create a simple PNG file (1x1 pixel transparent PNG)
    testImagePath = path.join(tempDir, 'test-image.png');
    const pngBuffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
      0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, // IDAT chunk
      0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
      0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, // IEND chunk
      0x42, 0x60, 0x82
    ]);
    fs.writeFileSync(testImagePath, pngBuffer);
  });

  test.afterAll(async () => {
    // Clean up temporary files
    if (testPdfPath && fs.existsSync(testPdfPath)) {
      fs.unlinkSync(testPdfPath);
    }
    if (testImagePath && fs.existsSync(testImagePath)) {
      fs.unlinkSync(testImagePath);
    }
  });

  test.beforeEach(async ({ page }) => {
    // Skip if no API key
    if (!process.env.ANTHROPIC_API_KEY) {
      test.skip();
    }

    // Clear localStorage before each test
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
    });
    await page.reload();

    // Navigate to the File Transformers page
    await page.click('text=File Transformers');

    // Wait for the page to load
    await expect(page.locator('h2:has-text("File Transformers Demo")')).toBeVisible();
  });

  test('should show progress indicator when uploading PDF', async ({ page }) => {
    // Wait for chat to be ready
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 10000 });

    // Get the file input element
    const fileInput = page.getByTestId('file-input');

    // Upload the PDF file
    await fileInput.setInputFiles(testPdfPath);

    // Wait for file chip to appear
    await expect(page.getByTestId('file-chip')).toBeVisible({ timeout: 5000 });

    // The PDF transformer reports progress, so we should see the progress indicator
    // Check for the processing overlay (which contains either progress bar or spinner)
    await expect(page.getByTestId('file-chip-processing')).toBeVisible({ timeout: 2000 });

    // Wait for the progress bar specifically (PDF transformer reports progress)
    await expect(page.getByTestId('progress-bar')).toBeVisible({ timeout: 2000 });

    // Wait for processing to complete (the PDF transformer takes ~4 seconds)
    await expect(page.getByTestId('file-chip-processing')).toBeHidden({ timeout: 10000 });

    console.log('[Test] PDF file processed successfully with progress indicator');
  });

  test('should show spinner when uploading image', async ({ page }) => {
    // Wait for chat to be ready
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 10000 });

    // Get the file input element
    const fileInput = page.getByTestId('file-input');

    // Upload the image file
    await fileInput.setInputFiles(testImagePath);

    // Wait for file chip to appear
    await expect(page.getByTestId('file-chip')).toBeVisible({ timeout: 5000 });

    // The image transformer doesn't report progress, so we should see the spinner
    await expect(page.getByTestId('file-chip-processing')).toBeVisible({ timeout: 2000 });

    // Check for spinner (image transformer doesn't report progress)
    await expect(page.getByTestId('spinner')).toBeVisible({ timeout: 2000 });

    // Wait for processing to complete (the image transformer takes ~2 seconds)
    await expect(page.getByTestId('file-chip-processing')).toBeHidden({ timeout: 5000 });

    console.log('[Test] Image file processed successfully with spinner');
  });

  test('should send transformed PDF content to AI', async ({ page }) => {
    // Wait for chat to be ready
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 10000 });

    const chatInput = page.getByTestId('chat-input');
    const sendButton = page.getByTestId('chat-send-button');
    const fileInput = page.getByTestId('file-input');

    // Upload the PDF file
    await fileInput.setInputFiles(testPdfPath);

    // Wait for file chip to appear and processing to complete
    await expect(page.getByTestId('file-chip')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('file-chip-processing')).toBeHidden({ timeout: 10000 });

    // Send message with the file
    await chatInput.fill('What is in this file?');
    await sendButton.click();

    // Wait for AI response
    await expect(async () => {
      const messages = await page.getByTestId('chat-message-assistant').all();
      expect(messages.length).toBeGreaterThan(0);

      const lastMessage = await messages[messages.length - 1].textContent();
      console.log('[Test] AI response:', lastMessage?.substring(0, 300));

      // The AI should mention something about the transformed/extracted content
      // The mock transformer returns "[Extracted PDF Content from...]"
      // The AI should acknowledge it received file content
      const mentionsFile = lastMessage?.toLowerCase().match(/file|document|pdf|content|extract|page|text/);
      expect(mentionsFile).toBeTruthy();
    }).toPass({ timeout: 45000, intervals: [2000] });

    console.log('[Test] AI successfully received and processed transformed PDF content');
  });

  test('should send transformed image content to AI', async ({ page }) => {
    // Wait for chat to be ready
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 10000 });

    const chatInput = page.getByTestId('chat-input');
    const sendButton = page.getByTestId('chat-send-button');
    const fileInput = page.getByTestId('file-input');

    // Upload the image file
    await fileInput.setInputFiles(testImagePath);

    // Wait for file chip to appear and processing to complete
    await expect(page.getByTestId('file-chip')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('file-chip-processing')).toBeHidden({ timeout: 5000 });

    // Send message with the file
    await chatInput.fill('Describe this image');
    await sendButton.click();

    // Wait for AI response
    await expect(async () => {
      const messages = await page.getByTestId('chat-message-assistant').all();
      expect(messages.length).toBeGreaterThan(0);

      const lastMessage = await messages[messages.length - 1].textContent();
      console.log('[Test] AI response:', lastMessage?.substring(0, 300));

      // The AI should mention something about the transformed/analyzed content
      // The mock transformer returns "[Image Analysis for...]"
      const mentionsImage = lastMessage?.toLowerCase().match(/image|file|png|analysis|visual|content/);
      expect(mentionsImage).toBeTruthy();
    }).toPass({ timeout: 45000, intervals: [2000] });

    console.log('[Test] AI successfully received and processed transformed image content');
  });

  test('should allow sending file without text message', async ({ page }) => {
    // This tests the fix for "text content blocks must be non-empty" error
    // Wait for chat to be ready
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 10000 });

    const sendButton = page.getByTestId('chat-send-button');
    const fileInput = page.getByTestId('file-input');

    // Upload the PDF file
    await fileInput.setInputFiles(testPdfPath);

    // Wait for file chip to appear and processing to complete
    await expect(page.getByTestId('file-chip')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('file-chip-processing')).toBeHidden({ timeout: 10000 });

    // Send without any text message (just the file)
    await sendButton.click();

    // Wait for AI response - should not error
    await expect(async () => {
      const messages = await page.getByTestId('chat-message-assistant').all();
      expect(messages.length).toBeGreaterThan(0);

      const lastMessage = await messages[messages.length - 1].textContent();
      console.log('[Test] AI response to file-only:', lastMessage?.substring(0, 300));

      // The AI should acknowledge the file
      expect(lastMessage).toBeTruthy();
    }).toPass({ timeout: 45000, intervals: [2000] });

    console.log('[Test] Successfully sent file without text message');
  });

  test('should show file chip with correct filename', async ({ page }) => {
    // Wait for chat to be ready
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 10000 });

    const fileInput = page.getByTestId('file-input');

    // Upload the PDF file
    await fileInput.setInputFiles(testPdfPath);

    // Wait for file chip to appear
    const fileChip = page.getByTestId('file-chip');
    await expect(fileChip).toBeVisible({ timeout: 5000 });

    // Check that the filename is displayed
    await expect(fileChip).toContainText('test-document.pdf');

    console.log('[Test] File chip shows correct filename');
  });

  test('should allow removing file before sending', async ({ page }) => {
    // Wait for chat to be ready
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 10000 });

    const fileInput = page.getByTestId('file-input');

    // Upload the PDF file
    await fileInput.setInputFiles(testPdfPath);

    // Wait for file chip to appear and processing to complete
    await expect(page.getByTestId('file-chip')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('file-chip-processing')).toBeHidden({ timeout: 10000 });

    // Click the remove button
    const removeButton = page.getByTestId('file-chip-remove');
    await removeButton.click();

    // File chip should be removed
    await expect(page.getByTestId('file-chip')).toBeHidden({ timeout: 2000 });

    console.log('[Test] File removed successfully');
  });

  test('should show file picker button', async ({ page }) => {
    // Wait for chat to be ready
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 10000 });

    // Check that the file picker button is visible
    const filePickerButton = page.getByTestId('file-picker-button');
    await expect(filePickerButton).toBeVisible();

    console.log('[Test] File picker button is visible');
  });
});
