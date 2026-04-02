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
 * Bug 1: Tool call data not persisted to localStorage
 *
 * After a page reload, the conversation history sent to the LLM provider
 * contains only text messages, missing all tool_use and tool_result blocks.
 *
 * Root causes:
 * 1. PersistedMessage type lacks `toolCalls` and `toolCallId` fields
 * 2. saveAIResponse() saves only the final text content, ignoring tool call metadata
 * 3. role: 'tool' messages are never written to localStorage
 * 4. transformMessagesToClientFormat() extracts text only when restoring messages
 * 5. transformMessagesToUI() narrows role to 'user' | 'assistant', dropping 'tool' messages
 */
describe('Bug 1: Tool call data persistence', () => {
  let storage: MockStorage;
  let repository: LocalStorageChatRepository;

  beforeEach(() => {
    storage = new MockStorage();
    repository = new LocalStorageChatRepository(storage);
  });

  describe('PersistedMessage type should support tool call fields', () => {
    it('should support toolCalls on assistant messages', async () => {
      const chatId = await repository.createChat();
      const chat = await repository.loadChat(chatId);

      if (!chat) throw new Error('Chat not found');

      const msg: PersistedMessage = {
        id: 'msg_1',
        role: 'assistant',
        content: '',
        createdAt: new Date(),
        toolCalls: [
          {
            id: 'toolu_123',
            type: 'function',
            function: {
              name: 'addTodo',
              arguments: '{"text":"buy groceries"}',
            },
          },
        ],
      };

      chat.messages.push(msg);
      await repository.saveChat(chat);

      const loadedChat = await repository.loadChat(chatId);
      const loadedMsg = loadedChat!.messages[0];

      expect(loadedMsg.toolCalls).toBeDefined();
      expect(loadedMsg.toolCalls!.length).toBe(1);
      expect(loadedMsg.toolCalls![0].function.name).toBe('addTodo');
    });

    it('should support toolCallId on tool messages', async () => {
      const chatId = await repository.createChat();
      const chat = await repository.loadChat(chatId);

      if (!chat) throw new Error('Chat not found');

      const toolMsg: PersistedMessage = {
        id: 'msg_tool_1',
        role: 'tool',
        content: '{"success":true}',
        createdAt: new Date(),
        toolCallId: 'toolu_123',
      };

      chat.messages.push(toolMsg);
      await repository.saveChat(chat);

      const loadedChat = await repository.loadChat(chatId);
      const loadedMsg = loadedChat!.messages[0];

      expect(loadedMsg.toolCallId).toBe('toolu_123');
    });
  });

  describe('transformMessagesToClientFormat should preserve tool data', () => {
    it('should preserve toolCalls on assistant messages', () => {
      const persistedMessages: PersistedMessage[] = [
        {
          id: 'msg_1',
          role: 'user',
          content: 'Add a todo: buy groceries',
          createdAt: new Date(),
        },
        {
          id: 'msg_2',
          role: 'assistant',
          content: '',
          createdAt: new Date(),
          toolCalls: [
            {
              id: 'toolu_123',
              type: 'function',
              function: {
                name: 'addTodo',
                arguments: '{"text":"buy groceries"}',
              },
            },
          ],
        },
      ];

      const clientMessages = transformMessagesToClientFormat(persistedMessages);

      const assistantMsg = clientMessages.find((m) => m.id === 'msg_2');
      expect(assistantMsg).toBeDefined();
      expect(assistantMsg!.toolCalls).toBeDefined();
      expect(
        (assistantMsg!.toolCalls as PersistedToolCall[])[0].function.name
      ).toBe('addTodo');
    });

    it('should preserve toolCallId on tool messages', () => {
      const persistedMessages: PersistedMessage[] = [
        {
          id: 'msg_tool_1',
          role: 'tool',
          content: '{"success":true}',
          createdAt: new Date(),
          toolCallId: 'toolu_123',
        },
      ];

      const clientMessages = transformMessagesToClientFormat(persistedMessages);

      const toolMsg = clientMessages[0];
      expect(toolMsg.toolCallId).toBe('toolu_123');
      expect(toolMsg.role).toBe('tool');
    });

    it('should include tool messages in the output', () => {
      const persistedMessages: PersistedMessage[] = [
        {
          id: 'msg_1',
          role: 'user',
          content: 'Add a todo',
          createdAt: new Date(),
        },
        {
          id: 'msg_2',
          role: 'assistant',
          content: '',
          createdAt: new Date(),
          toolCalls: [
            {
              id: 'toolu_123',
              type: 'function',
              function: {
                name: 'addTodo',
                arguments: '{"text":"buy groceries"}',
              },
            },
          ],
        },
        {
          id: 'msg_3',
          role: 'tool',
          content: '{"success":true}',
          createdAt: new Date(),
          toolCallId: 'toolu_123',
        },
        {
          id: 'msg_4',
          role: 'assistant',
          content: 'Done!',
          createdAt: new Date(),
        },
      ];

      const clientMessages = transformMessagesToClientFormat(persistedMessages);

      expect(clientMessages).toHaveLength(4);
      const roles = clientMessages.map((m) => m.role);
      expect(roles).toEqual(['user', 'assistant', 'tool', 'assistant']);
    });
  });

  describe('Full save/load round-trip should preserve conversation with tool calls', () => {
    it('should preserve complete conversation including tool exchanges after reload', async () => {
      const chatId = await repository.createChat();
      const chat = await repository.loadChat(chatId);

      if (!chat) throw new Error('Chat not found');

      // A complete conversation with tool calls
      chat.messages.push(
        {
          id: 'msg_user_1',
          role: 'user',
          content: 'Add a todo: buy groceries',
          createdAt: new Date(),
        },
        {
          id: 'msg_assistant_1',
          role: 'assistant',
          content: '',
          createdAt: new Date(),
          toolCalls: [
            {
              id: 'toolu_123',
              type: 'function',
              function: {
                name: 'addTodo',
                arguments: '{"text":"buy groceries"}',
              },
            },
          ],
        },
        {
          id: 'msg_tool_1',
          role: 'tool',
          content: '{"success":true,"message":"Todo added"}',
          createdAt: new Date(),
          toolCallId: 'toolu_123',
        },
        {
          id: 'msg_assistant_2',
          role: 'assistant',
          content: "I've added 'buy groceries' to your todo list.",
          createdAt: new Date(),
        },
      );

      await repository.saveChat(chat);

      // Simulate page reload: load from storage → transform to client format
      const loadedChat = await repository.loadChat(chatId);
      expect(loadedChat).not.toBeNull();
      expect(loadedChat!.messages).toHaveLength(4);

      const clientMessages = transformMessagesToClientFormat(
        loadedChat!.messages
      );

      // After full round-trip, we should have 4 messages
      expect(clientMessages).toHaveLength(4);

      // The assistant message with tool calls should still have them
      const assistantWithTools = clientMessages.find(
        (m) => m.id === 'msg_assistant_1'
      );
      expect(assistantWithTools).toBeDefined();
      expect(assistantWithTools!.toolCalls).toBeDefined();

      // The tool message should still have toolCallId
      const toolMsg = clientMessages.find((m) => m.id === 'msg_tool_1');
      expect(toolMsg).toBeDefined();
      expect(toolMsg!.toolCallId).toBe('toolu_123');
      expect(toolMsg!.role).toBe('tool');
    });
  });
});
