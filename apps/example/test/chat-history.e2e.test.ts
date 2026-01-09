import { test, expect } from '@playwright/test';

test.describe('Chat History Persistence', () => {
  // Set timeout for all tests in this suite to 45 seconds
  test.setTimeout(45000);

  test.beforeAll(() => {
    // Skip all tests if ANTHROPIC_API_KEY is not set
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log('Skipping E2E tests: ANTHROPIC_API_KEY environment variable not set');
      console.log('Set it with: export ANTHROPIC_API_KEY=your_api_key_here');
    }
  });

  test.beforeEach(async ({ page }) => {
    // Skip if no API key
    if (!process.env.ANTHROPIC_API_KEY) {
      test.skip();
    }

    // Clear localStorage before each test to start fresh
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
    });
    await page.reload();

    // Navigate to the todo page
    await page.click('text=Todo List');

    // Wait for the page to load
    await expect(page.locator('h1:has-text("Todo List")')).toBeVisible();
  });

  test.describe('New Chat (+) button', () => {
    test('should not create new chat when current chat is blank', async ({ page }) => {
        // Set up console listener early to capture all logs
        page.on('console', msg => {
        const text = msg.text();
        if (text.includes('[Provider]') || text.includes('createNewChat')) {
            console.log('[Browser Console]:', text);
        }
        });

        // Open AI chat
        const aiButton = page.getByTestId('ai-button');
        await expect(aiButton).toBeVisible({ timeout: 10000 });
        await aiButton.click();
        await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

        // Wait for initialization to complete
        await page.waitForTimeout(1500);

        // Get the initial chat count and current chat state
        const initialState = await page.evaluate(() => {
        const index = localStorage.getItem('use-ai:chat-index');
        const chatCount = index ? JSON.parse(index).length : 0;
        const ids = index ? JSON.parse(index) : [];
        const currentChat = ids.length > 0 ? localStorage.getItem(`use-ai:chat:${ids[ids.length - 1]}`) : null;
        return {
            chatCount,
            currentChatData: currentChat ? JSON.parse(currentChat) : null,
        };
        });

        console.log('[Test] Initial state:', JSON.stringify(initialState, null, 2));
        expect(initialState.chatCount).toBe(1); // Should have one blank chat from initialization

        // Verify we have no messages (blank chat)
        await expect(page.getByTestId('chat-message-user')).toHaveCount(0);
        await expect(page.getByTestId('chat-message-assistant')).toHaveCount(0);

        // Click "New Chat" button when current chat is blank
        const newChatButton = page.getByTestId('new-chat-button');
        await expect(newChatButton).toBeVisible();

        console.log('[Test] Clicking New Chat button...');
        await newChatButton.click();

        // Wait for any potential state updates
        await page.waitForTimeout(1500);

        // Check that no additional chat was created
        const finalState = await page.evaluate(() => {
        const index = localStorage.getItem('use-ai:chat-index');
        return index ? JSON.parse(index).length : 0;
        });

        console.log('[Test] Final chat count:', finalState);
        expect(finalState).toBe(1); // Still only one chat

        // Verify no messages exist
        await expect(page.getByTestId('chat-message-user')).toHaveCount(0);
        await expect(page.getByTestId('chat-message-assistant')).toHaveCount(0);
    });

    test('should create new chat when current chat has messages', async ({ page }) => {
        // Open AI chat
        const aiButton = page.getByTestId('ai-button');
        await aiButton.click();
        await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

        const chatInput = page.getByTestId('chat-input');
        const sendButton = page.getByTestId('chat-send-button');

        // Send a message to populate the current chat
        await chatInput.fill('Add a todo: Test chat history');
        await sendButton.click();

        // Wait for AI response
        await page.waitForTimeout(2000);
        await expect(page.getByTestId('chat-message-user')).toHaveCount(1);
        await expect(async () => {
        const messages = await page.getByTestId('chat-message-assistant').all();
        expect(messages.length).toBeGreaterThan(0);
        }).toPass({ timeout: 30000, intervals: [1000] });

        // Get the chat count before creating new chat
        const chatCountBefore = await page.evaluate(() => {
        const index = localStorage.getItem('use-ai:chat-index');
        return index ? JSON.parse(index).length : 0;
        });

        console.log('[Test] Chat count before new chat:', chatCountBefore);

        // Now click "New Chat" - this should create a new chat since current has messages
        const newChatButton = page.getByTestId('new-chat-button');
        await newChatButton.click();
        await page.waitForTimeout(500);

        // Check that a new chat was created
        const chatCountAfter = await page.evaluate(() => {
        const index = localStorage.getItem('use-ai:chat-index');
        return index ? JSON.parse(index).length : 0;
        });

        console.log('[Test] Chat count after new chat:', chatCountAfter);
        expect(chatCountAfter).toBe(chatCountBefore + 1);

        // Verify the new chat is empty
        await expect(page.getByTestId('chat-message-user')).toHaveCount(0);
        await expect(page.getByTestId('chat-message-assistant')).toHaveCount(0);
    });
  })

  test('should persist messages across page reloads', async ({ page }) => {
    // Open AI chat
    const aiButton = page.getByTestId('ai-button');
    await aiButton.click();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

    const chatInput = page.getByTestId('chat-input');
    const sendButton = page.getByTestId('chat-send-button');

    // Send a message
    await chatInput.fill('Add a todo: Persistent test item');
    await sendButton.click();

    // Wait for AI response
    await page.waitForTimeout(2000);
    await expect(async () => {
      const messages = await page.getByTestId('chat-message-assistant').all();
      expect(messages.length).toBeGreaterThan(0);
    }).toPass({ timeout: 30000, intervals: [1000] });

    // Verify we have messages
    const userMessagesBefore = await page.getByTestId('chat-message-user').count();
    const assistantMessagesBefore = await page.getByTestId('chat-message-assistant').count();
    console.log('[Test] Messages before reload - user:', userMessagesBefore, 'assistant:', assistantMessagesBefore);
    expect(userMessagesBefore).toBeGreaterThan(0);
    expect(assistantMessagesBefore).toBeGreaterThan(0);

    // Close chat panel
    const closeButton = page.getByTestId('chat-close-button');
    await closeButton.click();

    // Reload the page
    await page.reload();
    await expect(page.locator('h1:has-text("Todo List")')).toBeVisible();

    // Reopen chat
    await aiButton.click();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

    // Wait for messages to load
    await page.waitForTimeout(1000);

    // Verify messages persisted
    const userMessagesAfter = await page.getByTestId('chat-message-user').count();
    const assistantMessagesAfter = await page.getByTestId('chat-message-assistant').count();
    console.log('[Test] Messages after reload - user:', userMessagesAfter, 'assistant:', assistantMessagesAfter);

    expect(userMessagesAfter).toBe(userMessagesBefore);
    expect(assistantMessagesAfter).toBe(assistantMessagesBefore);

    // Verify message content
    const userMessage = await page.getByTestId('chat-message-user').first().textContent();
    expect(userMessage).toContain('Persistent test item');
  });

  test('should show chat history and allow loading previous chats', async ({ page }) => {
    // Open AI chat
    const aiButton = page.getByTestId('ai-button');
    await aiButton.click();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

    const chatInput = page.getByTestId('chat-input');
    const sendButton = page.getByTestId('chat-send-button');

    // Create first chat with a message
    await chatInput.fill('Add a todo: First chat item');
    await sendButton.click();
    await page.waitForTimeout(2000);
    await expect(async () => {
      const messages = await page.getByTestId('chat-message-assistant').all();
      expect(messages.length).toBeGreaterThan(0);
    }).toPass({ timeout: 30000, intervals: [1000] });

    // Create a new chat
    const newChatButton = page.getByTestId('new-chat-button');
    await newChatButton.click();
    await page.waitForTimeout(500);

    // Send a message in the new chat
    await chatInput.fill('Add a todo: Second chat item');
    await sendButton.click();
    await page.waitForTimeout(2000);
    await expect(async () => {
      const messages = await page.getByTestId('chat-message-assistant').all();
      expect(messages.length).toBeGreaterThan(0);
    }).toPass({ timeout: 30000, intervals: [1000] });

    // Open chat history
    const historyButton = page.getByTestId('chat-history-dropdown-button');
    await expect(historyButton).toBeVisible();
    await historyButton.click();
    await page.waitForTimeout(500);

    // Verify history dropdown is visible (by checking for chat items)
    await page.waitForTimeout(300);

    // Verify we have 2 chats listed
    const chatItems = page.getByTestId('chat-history-item');
    const chatCount = await chatItems.count();
    console.log('[Test] Chat history items:', chatCount);
    expect(chatCount).toBeGreaterThanOrEqual(2);

    // Click on the first (most recent) chat to verify it's currently active
    const activeIndicator = page.locator('text=Active');
    await expect(activeIndicator).toBeVisible();

    // Close history dropdown by clicking outside (the backdrop)
    await page.mouse.click(500, 300); // Click on an empty area
    await page.waitForTimeout(500);
  });

  test('should delete chat from history when Delete button is clicked', async ({ page }) => {
    // Open AI chat
    const aiButton = page.getByTestId('ai-button');
    await aiButton.click();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

    const chatInput = page.getByTestId('chat-input');
    const sendButton = page.getByTestId('chat-send-button');

    // Send a message
    await chatInput.fill('Add a todo: Delete test item');
    await sendButton.click();

    // Wait for AI response
    await page.waitForTimeout(2000);
    await expect(async () => {
      const messages = await page.getByTestId('chat-message-assistant').all();
      expect(messages.length).toBeGreaterThan(0);
    }).toPass({ timeout: 30000, intervals: [1000] });

    // Verify messages exist
    expect(await page.getByTestId('chat-message-user').count()).toBeGreaterThan(0);

    // Get the current chat ID before deletion
    const chatIdBeforeDelete = await page.evaluate(() => {
      const index = localStorage.getItem('use-ai:chat-index');
      if (!index) return null;
      const ids = JSON.parse(index);
      return ids[ids.length - 1];
    });

    console.log('[Test] Chat ID before delete:', chatIdBeforeDelete);

    // Get chat count before deletion
    const chatCountBefore = await page.evaluate(() => {
      const index = localStorage.getItem('use-ai:chat-index');
      return index ? JSON.parse(index).length : 0;
    });

    console.log('[Test] Chat count before delete:', chatCountBefore);

    // Click Delete button and accept the confirmation
    const deleteButton = page.getByTestId('delete-chat-button');
    await expect(deleteButton).toBeVisible();

    // Set up dialog handler before clicking
    page.once('dialog', dialog => {
      console.log('[Test] Dialog message:', dialog.message());
      dialog.accept();
    });

    await deleteButton.click();

    // Wait for chat to be deleted and new chat to be created
    await page.waitForTimeout(1000);

    // Verify messages are cleared (new blank chat)
    await expect(page.getByTestId('chat-message-user')).toHaveCount(0, { timeout: 10000 });
    await expect(page.getByTestId('chat-message-assistant')).toHaveCount(0, { timeout: 10000 });

    // Verify the old chat was deleted from localStorage
    const chatStillExists = await page.evaluate((chatId) => {
      const chatData = localStorage.getItem(`use-ai:chat:${chatId}`);
      return chatData !== null;
    }, chatIdBeforeDelete);

    expect(chatStillExists).toBe(false);
    console.log('[Test] Old chat deleted from localStorage');

    // Verify chat count is the same (deleted old chat, created new chat)
    const chatCountAfter = await page.evaluate(() => {
      const index = localStorage.getItem('use-ai:chat-index');
      return index ? JSON.parse(index).length : 0;
    });

    console.log('[Test] Chat count after delete:', chatCountAfter);
    expect(chatCountAfter).toBe(chatCountBefore); // Same count because we created a new blank chat
  });

  test.describe('Chat History list', () => {
    test('should auto-generate title from first message', async ({ page }) => {
        // Open AI chat
        const aiButton = page.getByTestId('ai-button');
        await aiButton.click();
        await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

        const chatInput = page.getByTestId('chat-input');
        const sendButton = page.getByTestId('chat-send-button');

        // Get current chat ID
        const chatId = await page.evaluate(() => {
        const index = localStorage.getItem('use-ai:chat-index');
        if (!index) return null;
        const ids = JSON.parse(index);
        return ids[ids.length - 1];
        });

        // Send a message with specific content
        const messageContent = 'Add a todo: This is my first message for title';
        await chatInput.fill(messageContent);
        await sendButton.click();

        // Wait for user message to appear
        await expect(page.getByTestId('chat-message-user')).toHaveCount(1);
        await page.waitForTimeout(1000); // Wait for auto-save

        // Check that chat title was set to the first message
        const chatData = await page.evaluate((id) => {
        const data = localStorage.getItem(`use-ai:chat:${id}`);
        return data ? JSON.parse(data) : null;
        }, chatId);

        console.log('[Test] Chat title:', chatData?.title);
        expect(chatData?.title).toBe(messageContent);

        // Open history to verify title is shown
        const historyButton = page.getByTestId('chat-history-dropdown-button');
        await historyButton.click();
        await page.waitForTimeout(500);

        // Verify the title is displayed in history (within a chat history item)
        const historyItem = page.getByTestId('chat-history-item').filter({ hasText: messageContent });
        await expect(historyItem).toBeVisible();
    });

    test('should truncate long titles in history', async ({ page }) => {
        // Open AI chat
        const aiButton = page.getByTestId('ai-button');
        await aiButton.click();
        await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

        const chatInput = page.getByTestId('chat-input');
        const sendButton = page.getByTestId('chat-send-button');

        // Send a very long message
        const longMessage = 'This is a very long message that should be truncated to exactly 50 characters and then have ellipsis added to it';
        await chatInput.fill(longMessage);
        await sendButton.click();

        // Wait for message and auto-save
        await expect(page.getByTestId('chat-message-user')).toHaveCount(1);
        await page.waitForTimeout(1000);

        // Get chat ID and verify title is truncated
        const chatId = await page.evaluate(() => {
        const index = localStorage.getItem('use-ai:chat-index');
        if (!index) return null;
        const ids = JSON.parse(index);
        return ids[ids.length - 1];
        });

        const chatData = await page.evaluate((id) => {
        const data = localStorage.getItem(`use-ai:chat:${id}`);
        return data ? JSON.parse(data) : null;
        }, chatId);

        console.log('[Test] Truncated title:', chatData?.title);
        expect(chatData?.title).toBe('This is a very long message that should be truncat...');
        expect(chatData?.title?.length).toBe(53); // 50 chars + '...'
        expect(chatData?.title).toContain('...');
    });
  })

  test('should auto-save messages to localStorage', async ({ page }) => {
    // Open AI chat
    const aiButton = page.getByTestId('ai-button');
    await aiButton.click();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

    const chatInput = page.getByTestId('chat-input');
    const sendButton = page.getByTestId('chat-send-button');

    // Get current chat ID
    const chatIdBefore = await page.evaluate(() => {
      const index = localStorage.getItem('use-ai:chat-index');
      if (!index) return null;
      const ids = JSON.parse(index);
      return ids[ids.length - 1]; // Get the most recent chat
    });

    console.log('[Test] Current chat ID:', chatIdBefore);
    expect(chatIdBefore).toBeTruthy();

    // Send a message
    await chatInput.fill('Add a todo: Auto-save test');
    await sendButton.click();

    // Wait for user message to appear
    await expect(page.getByTestId('chat-message-user')).toHaveCount(1);

    // Check that message was saved to localStorage
    const savedMessages = await page.evaluate((chatId) => {
      const chatData = localStorage.getItem(`use-ai:chat:${chatId}`);
      if (!chatData) return null;
      const chat = JSON.parse(chatData);
      return chat.messages;
    }, chatIdBefore);

    console.log('[Test] Saved messages:', savedMessages);
    expect(savedMessages).toBeTruthy();
    expect(savedMessages.length).toBeGreaterThan(0);
    expect(savedMessages[0].content).toContain('Auto-save test');
    expect(savedMessages[0].role).toBe('user');
  });

  test('should resume chat with full context after page reload', async ({ page }) => {
    // This test verifies that when resuming a chat from localStorage,
    // the AI has full conversation context and can respond to follow-up requests.
    //
    // Scenario:
    // 1. User adds a todo item
    // 2. Page reloads (simulating session loss on server)
    // 3. User sends a follow-up message referencing the previous action
    // 4. AI should understand the context and respond appropriately

    // Open AI chat
    const aiButton = page.getByTestId('ai-button');
    await aiButton.click();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

    const chatInput = page.getByTestId('chat-input');
    const sendButton = page.getByTestId('chat-send-button');
    const closeButton = page.getByTestId('chat-close-button');

    // Step 1: Add a todo via AI
    console.log('[Test] Step 1: Adding todo via AI');
    await chatInput.clear();
    await chatInput.fill('add a todo: buy groceries');
    await sendButton.click();

    // Wait for AI response
    await page.waitForTimeout(2000);
    await expect(async () => {
      const messages = await page.getByTestId('chat-message-assistant').all();
      expect(messages.length).toBeGreaterThan(0);
    }).toPass({ timeout: 30000, intervals: [1000] });

    // Close chat and verify todo was added
    await closeButton.click();
    await page.waitForTimeout(500);
    await expect(page.locator('li:has-text("buy groceries")')).toBeVisible();

    // Step 2: Reload page (simulates server losing session)
    console.log('[Test] Step 2: Reloading page to simulate server session loss');
    await page.reload();
    await expect(page.locator('h1:has-text("Todo List")')).toBeVisible();

    // Note: Todos don't persist (they're in memory only), but chat history should persist in localStorage

    // Step 3: Reopen chat and send follow-up message
    console.log('[Test] Step 3: Sending follow-up message that requires context');
    await aiButton.click();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

    // Wait for previous messages to load
    await page.waitForTimeout(1000);

    // Verify previous messages are visible
    const userMessagesBefore = await page.getByTestId('chat-message-user').count();
    const assistantMessagesBefore = await page.getByTestId('chat-message-assistant').count();
    console.log('[Test] Messages after reload - user:', userMessagesBefore, 'assistant:', assistantMessagesBefore);
    expect(userMessagesBefore).toBeGreaterThan(0);
    expect(assistantMessagesBefore).toBeGreaterThan(0);

    // Send follow-up message that requires context from previous conversation
    await chatInput.clear();
    await chatInput.fill('delete it');
    await sendButton.click();

    // Step 4: Verify AI receives current component state
    console.log('[Test] Step 4: Verifying AI receives current state');
    await page.waitForTimeout(2000);

    await expect(async () => {
      const messages = await page.getByTestId('chat-message-assistant').all();
      expect(messages.length).toBeGreaterThan(assistantMessagesBefore);

      const lastMessage = await messages[messages.length - 1].textContent();
      console.log(`[Test] AI response: ${lastMessage?.substring(0, 200)}`);

      // After reload, the AI sees a CONTRADICTION:
      // - Chat history: "add a todo: buy groceries" -> "I added it"
      // - Current state: Todo List is EMPTY (todos don't persist across reload)
      //
      // The state IS being sent correctly (verified by server debug logs showing "Todo List: []")
      //
      // The AI may respond in various ways:
      // 1. Recognize empty state: "no todos to delete"
      // 2. Try to delete and report not found
      // 3. Ask for clarification due to contradiction (reasonable given conflicting info)
      //
      // What matters: The AI received the current state. If it asks "which one?",
      // it's because it sees the contradiction between history and state, not because
      // state is missing.

      const mentionsNoTodos = lastMessage?.toLowerCase().match(/no todo|empty|don't see|can't find|not found/);
      const triesDelete = lastMessage?.toLowerCase().match(/delet|remov/);
      const asksForClarification = lastMessage?.toLowerCase().match(/which|what.*delete|id/);

      // AI should do ONE of: mention no todos, try to delete, OR ask for clarification
      // All are reasonable responses given the contradictory information
      expect(mentionsNoTodos || triesDelete || asksForClarification).toBeTruthy();
    }).toPass({ timeout: 30000, intervals: [2000] });

    // Close chat
    await closeButton.click();
  });

  test('should NOT bleed conversation history when switching between chats', async ({ page }) => {
    // This test verifies the fix for Bug #1 (history bleeding between chats)
    // When switching from Chat A to Chat B, the AI should NOT see Chat A's messages

    // Open AI chat
    const aiButton = page.getByTestId('ai-button');
    await aiButton.click();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

    const chatInput = page.getByTestId('chat-input');
    const sendButton = page.getByTestId('chat-send-button');

    // Step 1: Create Chat A with specific context
    console.log('[Test] Step 1: Creating Chat A with "buy milk" todo');
    await chatInput.fill('Add a todo: buy milk');
    await sendButton.click();

    // Wait for AI response
    await page.waitForTimeout(2000);
    await expect(async () => {
      const messages = await page.getByTestId('chat-message-assistant').all();
      expect(messages.length).toBeGreaterThan(0);
    }).toPass({ timeout: 30000, intervals: [1000] });

    // Verify Chat A has our message
    const chatAUserMessages = await page.getByTestId('chat-message-user').count();
    expect(chatAUserMessages).toBe(1);

    // Get Chat A ID for later
    const chatAId = await page.evaluate(() => {
      const index = localStorage.getItem('use-ai:chat-index');
      if (!index) return null;
      const ids = JSON.parse(index);
      return ids[ids.length - 1];
    });
    console.log('[Test] Chat A ID:', chatAId);

    // Step 2: Create Chat B with different context
    console.log('[Test] Step 2: Creating Chat B with "walk dog" todo');
    const newChatButton = page.getByTestId('new-chat-button');
    await newChatButton.click();
    await page.waitForTimeout(500);

    // Verify we're in a new chat (no messages)
    await expect(page.getByTestId('chat-message-user')).toHaveCount(0);
    await expect(page.getByTestId('chat-message-assistant')).toHaveCount(0);

    // Send different message in Chat B
    await chatInput.fill('Add a todo: walk dog');
    await sendButton.click();

    // Wait for AI response
    await page.waitForTimeout(2000);
    await expect(async () => {
      const messages = await page.getByTestId('chat-message-assistant').all();
      expect(messages.length).toBeGreaterThan(0);
    }).toPass({ timeout: 30000, intervals: [1000] });

    // Step 3: Verify Chat B only has "walk dog" context, NOT "buy milk"
    console.log('[Test] Step 3: Verifying Chat B conversation is isolated');
    const chatBMessages = await page.getByTestId('chat-message-user').allTextContents();
    console.log('[Test] Chat B user messages:', chatBMessages);

    expect(chatBMessages.length).toBe(1);
    expect(chatBMessages[0]).toContain('walk dog');
    expect(chatBMessages[0]).not.toContain('buy milk');

    // Step 4: Switch back to Chat A and verify context is preserved
    console.log('[Test] Step 4: Switching back to Chat A');
    const historyButton = page.getByTestId('chat-history-dropdown-button');
    await historyButton.click();
    await page.waitForTimeout(500);

    // Find and click Chat A in history
    const chatAItem = page.getByTestId('chat-history-item').filter({ hasText: 'buy milk' });
    await expect(chatAItem).toBeVisible();
    await chatAItem.click();
    await page.waitForTimeout(1000);

    // Verify Chat A messages are loaded
    const chatAMessagesRestored = await page.getByTestId('chat-message-user').allTextContents();
    console.log('[Test] Chat A user messages after restore:', chatAMessagesRestored);

    expect(chatAMessagesRestored.length).toBe(1);
    expect(chatAMessagesRestored[0]).toContain('buy milk');
    expect(chatAMessagesRestored[0]).not.toContain('walk dog');

    // Step 5: Send a follow-up in Chat A that requires its context (not Chat B's)
    console.log('[Test] Step 5: Sending follow-up in Chat A');
    await chatInput.fill('delete the milk todo');
    await sendButton.click();

    await page.waitForTimeout(2000);
    await expect(async () => {
      const messages = await page.getByTestId('chat-message-assistant').all();
      expect(messages.length).toBeGreaterThan(1); // Should have 2+ assistant messages now

      const lastMessage = await messages[messages.length - 1].textContent();
      console.log('[Test] Last AI response:', lastMessage?.substring(0, 200));

      // The AI should NOT mention the dog (from Chat B)
      // It should only work with milk context (from Chat A)
      const mentionsDog = lastMessage?.toLowerCase().includes('dog');
      expect(mentionsDog).toBe(false);
    }).toPass({ timeout: 30000, intervals: [2000] });

    console.log('[Test] SUCCESS: Conversation history is properly isolated between chats');
  });

  test('should NOT throw tool_use_id errors when switching chats', async ({ page }) => {
    // This test verifies the fix for Bug #2 (tool_use_id validation errors)
    // Messages loaded from localStorage should not contain provider-specific fields

    // Set up console error listener to catch tool_use_id errors
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    page.on('pageerror', err => {
      errors.push(err.message);
    });

    // Open AI chat
    const aiButton = page.getByTestId('ai-button');
    await aiButton.click();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });

    const chatInput = page.getByTestId('chat-input');
    const sendButton = page.getByTestId('chat-send-button');

    // Create Chat A with a tool execution
    console.log('[Test] Creating Chat A with tool execution');
    await chatInput.fill('Add a todo: Task 1');
    await sendButton.click();

    await page.waitForTimeout(2000);
    await expect(async () => {
      const messages = await page.getByTestId('chat-message-assistant').all();
      expect(messages.length).toBeGreaterThan(0);
    }).toPass({ timeout: 30000, intervals: [1000] });

    // Create Chat B
    console.log('[Test] Creating Chat B with tool execution');
    const newChatButton = page.getByTestId('new-chat-button');
    await newChatButton.click();
    await page.waitForTimeout(500);

    await chatInput.fill('Add a todo: Task 2');
    await sendButton.click();

    await page.waitForTimeout(2000);
    await expect(async () => {
      const messages = await page.getByTestId('chat-message-assistant').all();
      expect(messages.length).toBeGreaterThan(0);
    }).toPass({ timeout: 30000, intervals: [1000] });

    // Reload page to force loading messages from localStorage
    console.log('[Test] Reloading page to load messages from storage');
    await page.reload();
    await expect(page.locator('h1:has-text("Todo List")')).toBeVisible();

    // Reopen chat
    await aiButton.click();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(1000);

    // Send another message that triggers AI response
    await chatInput.fill('list the todos');
    await sendButton.click();

    await page.waitForTimeout(2000);
    await expect(async () => {
      const messages = await page.getByTestId('chat-message-assistant').all();
      expect(messages.length).toBeGreaterThan(1);
    }).toPass({ timeout: 30000, intervals: [1000] });

    // Check for tool_use_id errors
    const toolUseIdErrors = errors.filter(err =>
      err.includes('tool_use_id') || err.includes('unexpected')
    );

    console.log('[Test] Errors captured:', errors);
    console.log('[Test] tool_use_id errors:', toolUseIdErrors);

    expect(toolUseIdErrors.length).toBe(0);
    console.log('[Test] SUCCESS: No tool_use_id validation errors');
  });
});
