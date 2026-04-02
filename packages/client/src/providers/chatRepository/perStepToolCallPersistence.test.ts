import { describe, it, expect, beforeEach } from 'bun:test';
import { LocalStorageChatRepository } from './LocalStorageChatRepository';
import type { PersistedMessage, PersistedToolCall } from './types';
import { transformMessagesToClientFormat } from '../../hooks/useChatManagement';

class MockStorage implements Storage {
  private data: Map<string, string> = new Map();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  key(index: number): string | null {
    const keys = Array.from(this.data.keys());
    return keys[index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

/**
 * Bug: Per-step text+tool call association lost during persistence.
 *
 * When a multi-step agent run produces multiple steps each with text AND tool calls,
 * the saved conversation history should preserve per-step message boundaries:
 *   Step 0: assistant(text="Planning...", toolCalls=[tc1]) → tool(result1)
 *   Step 1: assistant(text="Retrying...", toolCalls=[tc2]) → tool(result2)
 *   Step 2: assistant(text="Final answer")
 *
 * Bug behavior (flattened):
 *   assistant(toolCalls=[tc1, tc2], content='') → tool(result1) → tool(result2) → assistant(content='All text concatenated')
 *
 * This test suite validates the correct per-step structure.
 */
describe('Per-step tool call persistence', () => {
  let storage: MockStorage;
  let repository: LocalStorageChatRepository;

  beforeEach(() => {
    storage = new MockStorage();
    repository = new LocalStorageChatRepository(storage);
  });

  describe('Per-step message structure', () => {
    it('assistant message with both toolCalls and content should preserve both', async () => {
      const chatId = await repository.createChat();
      const chat = await repository.loadChat(chatId);
      if (!chat) throw new Error('Chat not found');

      // A per-step message has BOTH text content and tool calls
      const msg: PersistedMessage = {
        id: 'msg_step0',
        role: 'assistant',
        content: 'Planning the task.',
        createdAt: new Date(),
        toolCalls: [
          {
            id: 'toolu_001',
            type: 'function',
            function: {
              name: 'search_users',
              arguments: '{"query":"yamamoto"}',
            },
          },
        ],
      };

      chat.messages.push(msg);
      await repository.saveChat(chat);

      const loadedChat = await repository.loadChat(chatId);
      const loadedMsg = loadedChat!.messages[0];

      // BOTH content and toolCalls should survive round-trip
      expect(loadedMsg.content).toBe('Planning the task.');
      expect(loadedMsg.toolCalls).toBeDefined();
      expect(loadedMsg.toolCalls!.length).toBe(1);
      expect(loadedMsg.toolCalls![0].function.name).toBe('search_users');
    });

    it('transformMessagesToClientFormat preserves content on assistant messages with toolCalls', () => {
      const persistedMessages: PersistedMessage[] = [
        {
          id: 'msg_step0',
          role: 'assistant',
          content: 'Planning the task.',
          createdAt: new Date(),
          toolCalls: [
            {
              id: 'toolu_001',
              type: 'function',
              function: {
                name: 'search_users',
                arguments: '{"query":"yamamoto"}',
              },
            },
          ],
        },
      ];

      const clientMessages = transformMessagesToClientFormat(persistedMessages);

      const msg = clientMessages[0];
      // Content should NOT be empty - it should preserve the step's text
      expect(msg.content).toBe('Planning the task.');
      expect(msg.toolCalls).toBeDefined();
      expect((msg.toolCalls as PersistedToolCall[])[0].function.name).toBe('search_users');
    });
  });

  describe('Full multi-step round-trip', () => {
    it('should preserve per-step message boundaries across save/load', async () => {
      const chatId = await repository.createChat();
      const chat = await repository.loadChat(chatId);
      if (!chat) throw new Error('Chat not found');

      // Correct per-step structure (what should be saved)
      chat.messages.push(
        // User message
        {
          id: 'msg_user',
          role: 'user',
          content: 'Search for Yamamoto',
          createdAt: new Date(),
        },
        // Step 0: assistant with text + tool call
        {
          id: 'msg_step0',
          role: 'assistant',
          content: 'Planning: search for user "Yamamoto".',
          createdAt: new Date(),
          toolCalls: [
            {
              id: 'toolu_001',
              type: 'function',
              function: {
                name: 'search_users',
                arguments: '{"query":"yamamoto"}',
              },
            },
          ],
        },
        // Step 0: tool result
        {
          id: 'msg_tool0',
          role: 'tool',
          content: '{"users":[],"total":0}',
          createdAt: new Date(),
          toolCallId: 'toolu_001',
        },
        // Step 1: assistant with text + tool call
        {
          id: 'msg_step1',
          role: 'assistant',
          content: 'Not found. Trying archived users.',
          createdAt: new Date(),
          toolCalls: [
            {
              id: 'toolu_002',
              type: 'function',
              function: {
                name: 'search_users',
                arguments: '{"query":"Yamamoto","includeArchived":true}',
              },
            },
          ],
        },
        // Step 1: tool result
        {
          id: 'msg_tool1',
          role: 'tool',
          content: '{"users":[],"total":0}',
          createdAt: new Date(),
          toolCallId: 'toolu_002',
        },
        // Step 2: final text only
        {
          id: 'msg_final',
          role: 'assistant',
          content: 'User Yamamoto was not found.',
          createdAt: new Date(),
        },
      );

      await repository.saveChat(chat);

      // Simulate reload: load → transform to client format
      const loadedChat = await repository.loadChat(chatId);
      expect(loadedChat!.messages).toHaveLength(6);

      const clientMessages = transformMessagesToClientFormat(loadedChat!.messages);
      expect(clientMessages).toHaveLength(6);

      // Verify per-step structure is preserved
      // Step 0 assistant: has BOTH content and toolCalls
      const step0 = clientMessages[1];
      expect(step0.role).toBe('assistant');
      expect(step0.content).toBe('Planning: search for user "Yamamoto".');
      expect(step0.toolCalls).toBeDefined();
      expect((step0.toolCalls as PersistedToolCall[])[0].id).toBe('toolu_001');

      // Step 0 tool result
      const tool0 = clientMessages[2];
      expect(tool0.role).toBe('tool');
      expect(tool0.toolCallId).toBe('toolu_001');

      // Step 1 assistant: has BOTH content and toolCalls
      const step1 = clientMessages[3];
      expect(step1.role).toBe('assistant');
      expect(step1.content).toBe('Not found. Trying archived users.');
      expect(step1.toolCalls).toBeDefined();
      expect((step1.toolCalls as PersistedToolCall[])[0].id).toBe('toolu_002');

      // Step 1 tool result
      const tool1 = clientMessages[4];
      expect(tool1.role).toBe('tool');
      expect(tool1.toolCallId).toBe('toolu_002');

      // Final assistant: text only, no toolCalls
      const final = clientMessages[5];
      expect(final.role).toBe('assistant');
      expect(final.content).toBe('User Yamamoto was not found.');
      expect(final.toolCalls).toBeUndefined();
    });

    it('per-step messages differ from flattened (bug) format', () => {
      // This documents the difference between correct and incorrect formats

      // BUG format: all tool calls merged, text in separate message
      const bugFormat: PersistedMessage[] = [
        {
          id: 'msg_user',
          role: 'user',
          content: 'Search for Yamamoto',
          createdAt: new Date(),
        },
        {
          id: 'msg_flat_toolcalls',
          role: 'assistant',
          content: '', // text is MISSING from this message
          createdAt: new Date(),
          toolCalls: [
            {
              id: 'toolu_001',
              type: 'function',
              function: { name: 'search_users', arguments: '{"query":"yamamoto"}' },
            },
            {
              id: 'toolu_002',
              type: 'function',
              function: { name: 'search_users', arguments: '{"query":"Yamamoto","includeArchived":true}' },
            },
          ],
        },
        {
          id: 'msg_tool0',
          role: 'tool',
          content: '{"users":[],"total":0}',
          createdAt: new Date(),
          toolCallId: 'toolu_001',
        },
        {
          id: 'msg_tool1',
          role: 'tool',
          content: '{"users":[],"total":0}',
          createdAt: new Date(),
          toolCallId: 'toolu_002',
        },
        {
          id: 'msg_flat_text',
          role: 'assistant',
          content: 'All text concatenated from all steps', // ALL text merged
          createdAt: new Date(),
          // no toolCalls - they're in a separate message
        },
      ];

      // CORRECT format: per-step messages
      const correctFormat: PersistedMessage[] = [
        {
          id: 'msg_user',
          role: 'user',
          content: 'Search for Yamamoto',
          createdAt: new Date(),
        },
        {
          id: 'msg_step0',
          role: 'assistant',
          content: 'Step 0 text',
          createdAt: new Date(),
          toolCalls: [
            {
              id: 'toolu_001',
              type: 'function',
              function: { name: 'search_users', arguments: '{"query":"yamamoto"}' },
            },
          ],
        },
        {
          id: 'msg_tool0',
          role: 'tool',
          content: '{"users":[],"total":0}',
          createdAt: new Date(),
          toolCallId: 'toolu_001',
        },
        {
          id: 'msg_step1',
          role: 'assistant',
          content: 'Step 1 text',
          createdAt: new Date(),
          toolCalls: [
            {
              id: 'toolu_002',
              type: 'function',
              function: { name: 'search_users', arguments: '{"query":"Yamamoto","includeArchived":true}' },
            },
          ],
        },
        {
          id: 'msg_tool1',
          role: 'tool',
          content: '{"users":[],"total":0}',
          createdAt: new Date(),
          toolCallId: 'toolu_002',
        },
        {
          id: 'msg_final',
          role: 'assistant',
          content: 'Final text',
          createdAt: new Date(),
        },
      ];

      const bugClientMessages = transformMessagesToClientFormat(bugFormat);
      const correctClientMessages = transformMessagesToClientFormat(correctFormat);

      // Bug format: tool call assistant has empty content
      const bugToolCallMsg = bugClientMessages.find(m => m.id === 'msg_flat_toolcalls');
      expect(bugToolCallMsg!.content).toBe('');

      // Correct format: each step's assistant has its own text
      const correctStep0 = correctClientMessages.find(m => m.id === 'msg_step0');
      expect(correctStep0!.content).toBe('Step 0 text');
      expect(correctStep0!.toolCalls).toBeDefined();

      const correctStep1 = correctClientMessages.find(m => m.id === 'msg_step1');
      expect(correctStep1!.content).toBe('Step 1 text');
      expect(correctStep1!.toolCalls).toBeDefined();

      // Bug format has 5 messages, correct format has 6 (each step is separate)
      expect(bugClientMessages.length).toBe(5);
      expect(correctClientMessages.length).toBe(6);
    });
  });
});
