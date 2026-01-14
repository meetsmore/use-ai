import { describe, it, expect, beforeEach } from 'bun:test';
import { LocalStorageChatRepository } from './LocalStorageChatRepository';
import type { Chat } from './types';

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

describe('LocalStorageChatRepository', () => {
  let storage: MockStorage;
  let repository: LocalStorageChatRepository;

  beforeEach(() => {
    storage = new MockStorage();
    repository = new LocalStorageChatRepository(storage);
  });

  describe('createChat', () => {
    it('should create a new chat with a unique ID', async () => {
      const chatId = await repository.createChat();
      expect(chatId).toMatch(/^chat_\d+_[a-z0-9]+$/);
    });

    it('should create a chat with a title', async () => {
      const chatId = await repository.createChat({ title: 'Test Chat' });
      const chat = await repository.loadChat(chatId);

      expect(chat).not.toBeNull();
      expect(chat!.title).toBe('Test Chat');
    });

    it('should initialize chat with empty messages', async () => {
      const chatId = await repository.createChat();
      const chat = await repository.loadChat(chatId);

      expect(chat!.messages).toEqual([]);
    });

    it('should add chat ID to index', async () => {
      const chatId = await repository.createChat();
      const chats = await repository.listChats();

      expect(chats).toHaveLength(1);
      expect(chats[0].id).toBe(chatId);
    });
  });

  describe('loadChat', () => {
    it('should return null for non-existent chat', async () => {
      const chat = await repository.loadChat('non-existent-id');
      expect(chat).toBeNull();
    });

    it('should load an existing chat', async () => {
      const chatId = await repository.createChat({ title: 'My Chat' });
      const chat = await repository.loadChat(chatId);

      expect(chat).not.toBeNull();
      expect(chat!.id).toBe(chatId);
      expect(chat!.title).toBe('My Chat');
    });

    it('should deserialize dates correctly', async () => {
      const chatId = await repository.createChat();
      const chat = await repository.loadChat(chatId);

      expect(chat!.createdAt).toBeInstanceOf(Date);
      expect(chat!.updatedAt).toBeInstanceOf(Date);
    });

    it('should deserialize message dates correctly', async () => {
      const chatId = await repository.createChat();
      const chat = await repository.loadChat(chatId);

      if (chat) {
        chat.messages.push({
          id: 'msg1',
          role: 'user',
          content: 'Hello',
          createdAt: new Date(),
        });
        await repository.saveChat(chat);
      }

      const loadedChat = await repository.loadChat(chatId);
      expect(loadedChat!.messages[0].createdAt).toBeInstanceOf(Date);
    });
  });

  describe('saveChat', () => {
    it('should save a chat', async () => {
      const chatId = await repository.createChat();
      const chat = await repository.loadChat(chatId);

      chat!.messages.push({
        id: 'msg1',
        role: 'user',
        content: 'Test message',
        createdAt: new Date(),
      });

      await repository.saveChat(chat!);

      const loadedChat = await repository.loadChat(chatId);
      expect(loadedChat!.messages).toHaveLength(1);
      expect(loadedChat!.messages[0].content).toBe('Test message');
    });

    it('should update the updatedAt timestamp', async () => {
      const chatId = await repository.createChat();
      const chat = await repository.loadChat(chatId);
      const originalUpdatedAt = chat!.updatedAt;

      await new Promise(resolve => setTimeout(resolve, 10));

      await repository.saveChat(chat!);
      const loadedChat = await repository.loadChat(chatId);

      expect(loadedChat!.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
    });
  });

  describe('deleteChat', () => {
    it('should delete a chat', async () => {
      const chatId = await repository.createChat();
      await repository.deleteChat(chatId);

      const chat = await repository.loadChat(chatId);
      expect(chat).toBeNull();
    });

    it('should remove chat from index', async () => {
      const chatId = await repository.createChat();
      await repository.deleteChat(chatId);

      const chats = await repository.listChats();
      expect(chats).toHaveLength(0);
    });

    it('should not throw when deleting non-existent chat', async () => {
      await expect(repository.deleteChat('non-existent-id')).resolves.toBeUndefined();
    });
  });

  describe('listChats', () => {
    it('should return empty array when no chats exist', async () => {
      const chats = await repository.listChats();
      expect(chats).toEqual([]);
    });

    it('should list all chats without messages', async () => {
      const chatId1 = await repository.createChat({ title: 'Chat 1' });
      const chatId2 = await repository.createChat({ title: 'Chat 2' });

      const chats = await repository.listChats();

      expect(chats).toHaveLength(2);
      expect(chats[0]).not.toHaveProperty('messages');
      expect(chats[1]).not.toHaveProperty('messages');
    });

    it('should sort chats by updatedAt descending', async () => {
      const chatId1 = await repository.createChat({ title: 'Chat 1' });
      await new Promise(resolve => setTimeout(resolve, 10));
      const chatId2 = await repository.createChat({ title: 'Chat 2' });

      const chats = await repository.listChats();

      expect(chats[0].id).toBe(chatId2);
      expect(chats[1].id).toBe(chatId1);
    });

    it('should respect limit option', async () => {
      await repository.createChat({ title: 'Chat 1' });
      await repository.createChat({ title: 'Chat 2' });
      await repository.createChat({ title: 'Chat 3' });

      const chats = await repository.listChats({ limit: 2 });
      expect(chats).toHaveLength(2);
    });

    it('should respect offset option', async () => {
      await repository.createChat({ title: 'Chat 1' });
      await new Promise(resolve => setTimeout(resolve, 10));
      await repository.createChat({ title: 'Chat 2' });
      await new Promise(resolve => setTimeout(resolve, 10));
      await repository.createChat({ title: 'Chat 3' });

      const chats = await repository.listChats({ offset: 1 });
      expect(chats).toHaveLength(2);
      expect(chats[0].title).toBe('Chat 2');
    });

    it('should respect both limit and offset', async () => {
      await repository.createChat({ title: 'Chat 1' });
      await new Promise(resolve => setTimeout(resolve, 10));
      await repository.createChat({ title: 'Chat 2' });
      await new Promise(resolve => setTimeout(resolve, 10));
      await repository.createChat({ title: 'Chat 3' });

      const chats = await repository.listChats({ offset: 1, limit: 1 });
      expect(chats).toHaveLength(1);
      expect(chats[0].title).toBe('Chat 2');
    });
  });

  describe('deleteAll', () => {
    it('should delete all chats', async () => {
      await repository.createChat({ title: 'Chat 1' });
      await repository.createChat({ title: 'Chat 2' });
      await repository.createChat({ title: 'Chat 3' });

      await repository.deleteAll();

      const chats = await repository.listChats();
      expect(chats).toEqual([]);
    });

    it('should clear the index', async () => {
      const chatId1 = await repository.createChat();
      const chatId2 = await repository.createChat();

      await repository.deleteAll();

      const chat1 = await repository.loadChat(chatId1);
      const chat2 = await repository.loadChat(chatId2);

      expect(chat1).toBeNull();
      expect(chat2).toBeNull();
    });
  });

  describe('citation persistence', () => {
    it('should save and load messages with citations', async () => {
      const chatId = await repository.createChat();
      const chat = await repository.loadChat(chatId);

      chat!.messages.push({
        id: 'msg1',
        role: 'assistant',
        content: 'According to research [1], this is true.',
        createdAt: new Date(),
        citations: [
          {
            id: 'cite-1',
            number: 1,
            type: 'url',
            url: 'https://example.com/research',
            title: 'Research Paper',
          },
        ],
      });

      await repository.saveChat(chat!);

      const loadedChat = await repository.loadChat(chatId);
      expect(loadedChat!.messages).toHaveLength(1);
      expect(loadedChat!.messages[0].citations).toHaveLength(1);
      expect(loadedChat!.messages[0].citations![0].number).toBe(1);
      expect(loadedChat!.messages[0].citations![0].url).toBe('https://example.com/research');
      expect(loadedChat!.messages[0].citations![0].title).toBe('Research Paper');
    });

    it('should handle messages with multiple citations', async () => {
      const chatId = await repository.createChat();
      const chat = await repository.loadChat(chatId);

      chat!.messages.push({
        id: 'msg1',
        role: 'assistant',
        content: 'See [1] and [2] for details.',
        createdAt: new Date(),
        citations: [
          {
            id: 'cite-1',
            number: 1,
            type: 'url',
            url: 'https://example.com/source1',
            title: 'Source One',
          },
          {
            id: 'cite-2',
            number: 2,
            type: 'url',
            url: 'https://example.com/source2',
            title: 'Source Two',
          },
        ],
      });

      await repository.saveChat(chat!);

      const loadedChat = await repository.loadChat(chatId);
      expect(loadedChat!.messages[0].citations).toHaveLength(2);
      expect(loadedChat!.messages[0].citations![0].number).toBe(1);
      expect(loadedChat!.messages[0].citations![1].number).toBe(2);
    });

    it('should handle messages without citations (undefined)', async () => {
      const chatId = await repository.createChat();
      const chat = await repository.loadChat(chatId);

      chat!.messages.push({
        id: 'msg1',
        role: 'user',
        content: 'Hello',
        createdAt: new Date(),
        // No citations field
      });

      await repository.saveChat(chat!);

      const loadedChat = await repository.loadChat(chatId);
      expect(loadedChat!.messages[0].citations).toBeUndefined();
    });

    it('should handle messages with empty citations array', async () => {
      const chatId = await repository.createChat();
      const chat = await repository.loadChat(chatId);

      chat!.messages.push({
        id: 'msg1',
        role: 'assistant',
        content: 'No citations here.',
        createdAt: new Date(),
        citations: [],
      });

      await repository.saveChat(chat!);

      const loadedChat = await repository.loadChat(chatId);
      expect(loadedChat!.messages[0].citations).toEqual([]);
    });

    it('should preserve all citation properties', async () => {
      const chatId = await repository.createChat();
      const chat = await repository.loadChat(chatId);

      chat!.messages.push({
        id: 'msg1',
        role: 'assistant',
        content: 'Full citation test [1]',
        createdAt: new Date(),
        citations: [
          {
            id: 'cite-full',
            number: 1,
            type: 'url',
            url: 'https://example.com/full',
            title: 'Full Citation',
            snippet: 'This is a snippet from the source',
            toolName: 'web_search',
            metadata: { provider: 'test', confidence: 0.95 },
          },
        ],
      });

      await repository.saveChat(chat!);

      const loadedChat = await repository.loadChat(chatId);
      const citation = loadedChat!.messages[0].citations![0];
      expect(citation.id).toBe('cite-full');
      expect(citation.number).toBe(1);
      expect(citation.type).toBe('url');
      expect(citation.url).toBe('https://example.com/full');
      expect(citation.title).toBe('Full Citation');
      expect(citation.snippet).toBe('This is a snippet from the source');
      expect(citation.toolName).toBe('web_search');
      expect(citation.metadata).toEqual({ provider: 'test', confidence: 0.95 });
    });
  });

  describe('maxChats limit', () => {
    it('should enforce max chats limit when creating new chat', async () => {
      const smallRepository = new LocalStorageChatRepository(storage, 3);

      const chatId1 = await smallRepository.createChat({ title: 'Chat 1' });
      await new Promise(resolve => setTimeout(resolve, 10));
      const chatId2 = await smallRepository.createChat({ title: 'Chat 2' });
      await new Promise(resolve => setTimeout(resolve, 10));
      const chatId3 = await smallRepository.createChat({ title: 'Chat 3' });
      await new Promise(resolve => setTimeout(resolve, 10));

      // This should delete Chat 1 (oldest)
      const chatId4 = await smallRepository.createChat({ title: 'Chat 4' });

      const chats = await smallRepository.listChats();
      expect(chats).toHaveLength(3);

      const chat1 = await smallRepository.loadChat(chatId1);
      expect(chat1).toBeNull();

      const chat4 = await smallRepository.loadChat(chatId4);
      expect(chat4).not.toBeNull();
    });

    it('should delete oldest chat by updatedAt', async () => {
      const smallRepository = new LocalStorageChatRepository(storage, 2);

      const chatId1 = await smallRepository.createChat({ title: 'Chat 1' });
      await new Promise(resolve => setTimeout(resolve, 10));
      const chatId2 = await smallRepository.createChat({ title: 'Chat 2' });
      await new Promise(resolve => setTimeout(resolve, 10));

      // Update chat 1 so it's now the newest
      const chat1 = await smallRepository.loadChat(chatId1);
      if (chat1) {
        chat1.messages.push({
          id: 'msg1',
          role: 'user',
          content: 'Update',
          createdAt: new Date(),
        });
        await smallRepository.saveChat(chat1);
      }

      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify chat1 has been updated more recently than chat2
      const chat1Loaded = await smallRepository.loadChat(chatId1);
      const chat2Loaded = await smallRepository.loadChat(chatId2);
      expect(chat1Loaded!.updatedAt.getTime()).toBeGreaterThan(chat2Loaded!.updatedAt.getTime());

      // This should delete Chat 2 (now the oldest by updatedAt)
      const chatId3 = await smallRepository.createChat({ title: 'Chat 3' });

      const chats = await smallRepository.listChats();
      expect(chats).toHaveLength(2);

      const chat2After = await smallRepository.loadChat(chatId2);
      expect(chat2After).toBeNull();

      const chat1After = await smallRepository.loadChat(chatId1);
      const chat3After = await smallRepository.loadChat(chatId3);
      expect(chat1After).not.toBeNull();
      expect(chat3After).not.toBeNull();
    });

    it('should handle creating multiple chats over limit', async () => {
      const smallRepository = new LocalStorageChatRepository(storage, 3);

      const chatIds: string[] = [];
      for (let i = 0; i < 5; i++) {
        chatIds.push(await smallRepository.createChat({ title: `Chat ${i + 1}` }));
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      const chats = await smallRepository.listChats();
      expect(chats).toHaveLength(3);

      // First two chats should be deleted
      const chat1 = await smallRepository.loadChat(chatIds[0]);
      const chat2 = await smallRepository.loadChat(chatIds[1]);
      expect(chat1).toBeNull();
      expect(chat2).toBeNull();

      // Last three chats should remain
      const chat3 = await smallRepository.loadChat(chatIds[2]);
      const chat4 = await smallRepository.loadChat(chatIds[3]);
      const chat5 = await smallRepository.loadChat(chatIds[4]);
      expect(chat3).not.toBeNull();
      expect(chat4).not.toBeNull();
      expect(chat5).not.toBeNull();
    });

    it('should default to 20 chats max', async () => {
      const defaultRepository = new LocalStorageChatRepository(storage);

      // Create 21 chats
      const chatIds: string[] = [];
      for (let i = 0; i < 21; i++) {
        chatIds.push(await defaultRepository.createChat({ title: `Chat ${i + 1}` }));
        await new Promise(resolve => setTimeout(resolve, 5));
      }

      const chats = await defaultRepository.listChats();
      expect(chats).toHaveLength(20);

      // First chat should be deleted
      const firstChat = await defaultRepository.loadChat(chatIds[0]);
      expect(firstChat).toBeNull();

      // Last chat should exist
      const lastChat = await defaultRepository.loadChat(chatIds[20]);
      expect(lastChat).not.toBeNull();
    });
  });
});
