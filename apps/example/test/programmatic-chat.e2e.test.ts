import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Programmatic Chat', () => {
  test.setTimeout(60000);

  test.beforeAll(() => {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log('Skipping E2E tests: ANTHROPIC_API_KEY environment variable not set');
      console.log('Set it with: export ANTHROPIC_API_KEY=your_api_key_here');
    }
  });

  test.beforeEach(async ({ page }) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      test.skip();
    }

    // Clear localStorage before each test
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
    });
    await page.reload();

    // Navigate to Programmatic Chat page
    await page.click('text=Programmatic Chat');
    await expect(page.locator('h1:has-text("Programmatic Chat Demo")')).toBeVisible();

    // Wait for connection
    await expect(page.getByTestId('status-connected')).toBeVisible({ timeout: 10000 });
  });

  test.describe('Preset Messages', () => {
    test('should send "Ask capabilities" message and open chat panel', async ({ page }) => {
      // Click the "Ask capabilities" button
      const askButton = page.getByTestId('btn-ask-capabilities');
      await expect(askButton).toBeEnabled();
      await askButton.click();

      // Chat panel should open automatically
      await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

      // User message should appear in chat
      const userMessage = page.getByTestId('chat-message-user');
      await expect(userMessage).toBeVisible({ timeout: 5000 });
      await expect(userMessage).toContainText('What can you help me with?');

      // Wait for AI response
      await expect(async () => {
        const messages = await page.getByTestId('chat-message-assistant').all();
        expect(messages.length).toBeGreaterThan(0);
      }).toPass({ timeout: 30000, intervals: [1000] });

      // Verify assistant responded
      const assistantMessage = page.getByTestId('chat-message-assistant').first();
      await expect(assistantMessage).toBeVisible();
    });

    test('should send "Tell a joke" message via programmatic API', async ({ page }) => {
      // Click the "Tell a joke" button
      const jokeButton = page.getByTestId('btn-tell-joke');
      await expect(jokeButton).toBeEnabled();
      await jokeButton.click();

      // Chat panel should open
      await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

      // User message should appear
      const userMessage = page.getByTestId('chat-message-user');
      await expect(userMessage).toContainText('Tell me a joke');

      // Wait for AI response
      await expect(async () => {
        const messages = await page.getByTestId('chat-message-assistant').all();
        expect(messages.length).toBeGreaterThan(0);
      }).toPass({ timeout: 30000, intervals: [1000] });
    });

    test('should create new chat when "New chat + greeting" is clicked', async ({ page }) => {
      // First, send a message to establish existing chat
      const askButton = page.getByTestId('btn-ask-capabilities');
      await askButton.click();

      // Wait for chat to open and message to appear
      await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });
      await expect(page.getByTestId('chat-message-user')).toBeVisible({ timeout: 5000 });

      // Wait for AI response
      await expect(async () => {
        const messages = await page.getByTestId('chat-message-assistant').all();
        expect(messages.length).toBeGreaterThan(0);
      }).toPass({ timeout: 30000, intervals: [1000] });

      // Get chat count before
      const chatCountBefore = await page.evaluate(() => {
        const index = localStorage.getItem('use-ai:chat-index');
        return index ? JSON.parse(index).length : 0;
      });
      console.log('[Test] Chat count before new chat:', chatCountBefore);

      // Close chat panel
      await page.getByTestId('chat-close-button').click();
      await expect(page.getByTestId('chat-input')).not.toBeVisible();

      // Click "New chat + greeting" button
      const newChatButton = page.getByTestId('btn-new-chat-greeting');
      await newChatButton.click();

      // Chat panel should open with the new message
      await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

      // Should have exactly 1 user message (the new greeting)
      await expect(page.getByTestId('chat-message-user')).toHaveCount(1);
      await expect(page.getByTestId('chat-message-user')).toContainText('Hello! Starting a fresh conversation.');

      // Wait for chat count to increase
      await page.waitForTimeout(1000);
      const chatCountAfter = await page.evaluate(() => {
        const index = localStorage.getItem('use-ai:chat-index');
        return index ? JSON.parse(index).length : 0;
      });
      console.log('[Test] Chat count after new chat:', chatCountAfter);
      expect(chatCountAfter).toBe(chatCountBefore + 1);
    });
  });

  test.describe('File Attachment', () => {
    test('should enable send button when file is selected', async ({ page }) => {
      // Initially, send button should be disabled (no file selected)
      const sendButton = page.getByTestId('btn-send-with-file');
      await expect(sendButton).toBeDisabled();

      // Select a file
      const fileInput = page.getByTestId('file-input');

      // Create a test file using Playwright's file chooser
      await fileInput.setInputFiles({
        name: 'test-image.png',
        mimeType: 'image/png',
        buffer: Buffer.from('fake image content for testing'),
      });

      // File info should appear
      await expect(page.getByTestId('file-info')).toBeVisible();
      await expect(page.getByTestId('file-name')).toContainText('test-image.png');

      // Send button should now be enabled
      await expect(sendButton).toBeEnabled();
    });

    test('should send message with file attachment', async ({ page }) => {
      // Select a file
      const fileInput = page.getByTestId('file-input');
      await fileInput.setInputFiles({
        name: 'test-document.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('This is test content for the AI to analyze.'),
      });

      // Verify file is selected
      await expect(page.getByTestId('file-name')).toContainText('test-document.txt');

      // Click send button
      const sendButton = page.getByTestId('btn-send-with-file');
      await expect(sendButton).toBeEnabled();
      await sendButton.click();

      // Chat panel should open
      await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

      // User message should appear with the expected text
      const userMessage = page.getByTestId('chat-message-user');
      await expect(userMessage).toBeVisible({ timeout: 5000 });
      await expect(userMessage).toContainText('Please analyze this file');

      // File info should be cleared after sending
      await expect(page.getByTestId('file-info')).not.toBeVisible();

      // Send button should be disabled again (no file selected)
      await expect(sendButton).toBeDisabled();
    });

    test('should show file attachment chip in chat message', async ({ page }) => {
      // Select a text file (using text to avoid image validation errors from the API)
      const fileInput = page.getByTestId('file-input');
      await fileInput.setInputFiles({
        name: 'notes.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('Some notes content for testing'),
      });

      // Send the message
      await page.getByTestId('btn-send-with-file').click();

      // Chat should open
      await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

      // User message should be visible
      await expect(page.getByTestId('chat-message-user')).toBeVisible({ timeout: 5000 });

      // The message should contain the file attachment indicator
      // (File chips are rendered as part of the user message)
      const userMessage = page.getByTestId('chat-message-user');
      await expect(userMessage).toContainText('notes.txt');
    });
  });

  test.describe('Message Queueing', () => {
    test('should queue multiple rapid programmatic messages', async ({ page }) => {
      // Send first message
      await page.getByTestId('btn-ask-capabilities').click();

      // Wait just a moment for the message to be sent
      await page.waitForTimeout(100);

      // Immediately send second message (should be queued)
      await page.getByTestId('btn-tell-joke').click();

      // Chat panel should open
      await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

      // Wait for both messages to eventually appear
      // The queue processes one at a time, waiting for response
      await expect(async () => {
        const userMessages = await page.getByTestId('chat-message-user').all();
        // At minimum, the first message should be there
        expect(userMessages.length).toBeGreaterThanOrEqual(1);
      }).toPass({ timeout: 10000, intervals: [500] });

      // First message should be visible
      const firstMessage = page.getByTestId('chat-message-user').first();
      await expect(firstMessage).toContainText('What can you help me with?');
    });
  });

  test.describe('Chat Panel Integration', () => {
    test('should allow continuing conversation after programmatic message', async ({ page }) => {
      // Send programmatic message
      await page.getByTestId('btn-ask-capabilities').click();

      // Wait for chat to open and AI to respond
      await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });
      await expect(async () => {
        const messages = await page.getByTestId('chat-message-assistant').all();
        expect(messages.length).toBeGreaterThan(0);
      }).toPass({ timeout: 30000, intervals: [1000] });

      // Now type a follow-up message manually
      const chatInput = page.getByTestId('chat-input');
      await chatInput.fill('Can you tell me more about the first one?');
      await page.getByTestId('chat-send-button').click();

      // Should have 2 user messages now
      await expect(async () => {
        const userMessages = await page.getByTestId('chat-message-user').all();
        expect(userMessages.length).toBe(2);
      }).toPass({ timeout: 10000, intervals: [500] });

      // Wait for second AI response
      await expect(async () => {
        const assistantMessages = await page.getByTestId('chat-message-assistant').all();
        expect(assistantMessages.length).toBe(2);
      }).toPass({ timeout: 30000, intervals: [1000] });
    });
  });
});
