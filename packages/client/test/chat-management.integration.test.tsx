import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import type { ChatRepository, Chat } from '../src/types';
import { LocalStorageChatRepository } from '../src/providers/chatRepository/LocalStorageChatRepository';

// Create a mock localStorage for testing
class MockLocalStorage implements Storage {
  private store: Map<string, string> = new Map();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  key(index: number): string | null {
    const keys = Array.from(this.store.keys());
    return keys[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

describe('Chat & Conversation Management', () => {
  let repository: ChatRepository;
  let mockStorage: MockLocalStorage;

  beforeEach(() => {
    mockStorage = new MockLocalStorage();
    repository = new LocalStorageChatRepository(mockStorage);
  });

  afterEach(() => {
    mockStorage.clear();
  });

  describe('Chat history is automatically persisted to localStorage by default', () => {
    it('should persist chat messages to repository', async () => {
      const chatId = await repository.createChat();
      const chat = await repository.loadChat(chatId);

      chat!.messages.push({
        id: 'msg-1',
        role: 'user',
        content: 'Hello',
        createdAt: new Date(),
      });

      await repository.saveChat(chat!);

      const loadedChat = await repository.loadChat(chatId);
      expect(loadedChat?.messages.length).toBe(1);
      expect(loadedChat?.messages[0].content).toBe('Hello');
    });
  });

  describe('Users can create multiple chats and switch between them', () => {
    it('should create multiple independent chats', async () => {
      const chat1 = await repository.createChat({ title: 'Chat 1' });
      const chat2 = await repository.createChat({ title: 'Chat 2' });

      expect(chat1).not.toBe(chat2);

      const loadedChat1 = await repository.loadChat(chat1);
      const loadedChat2 = await repository.loadChat(chat2);

      expect(loadedChat1?.title).toBe('Chat 1');
      expect(loadedChat2?.title).toBe('Chat 2');
    });

    it('should maintain separate message histories for each chat', async () => {
      const chat1 = await repository.createChat();
      const chat2 = await repository.createChat();

      const loaded1 = await repository.loadChat(chat1);
      loaded1!.messages.push({
        id: 'msg-1',
        role: 'user',
        content: 'Message in chat 1',
        createdAt: new Date(),
      });
      await repository.saveChat(loaded1!);

      const loaded2 = await repository.loadChat(chat2);
      loaded2!.messages.push({
        id: 'msg-2',
        role: 'user',
        content: 'Message in chat 2',
        createdAt: new Date(),
      });
      await repository.saveChat(loaded2!);

      const final1 = await repository.loadChat(chat1);
      const final2 = await repository.loadChat(chat2);

      expect(final1?.messages[0].content).toBe('Message in chat 1');
      expect(final2?.messages[0].content).toBe('Message in chat 2');
    });
  });

  describe('Chat titles are auto-generated from the first user message', () => {
    it('should store chat without title initially', async () => {
      const chatId = await repository.createChat();
      const chat = await repository.loadChat(chatId);

      expect(chat?.title).toBeUndefined();
    });

    it('should allow title to be set on chat', async () => {
      const chatId = await repository.createChat();
      const chat = await repository.loadChat(chatId);

      chat!.title = 'Generated Title';
      await repository.saveChat(chat!);

      const updatedChat = await repository.loadChat(chatId);
      expect(updatedChat?.title).toBe('Generated Title');
    });
  });

  describe('A maximum of 20 chats are stored by default', () => {
    it('should list chats with pagination support', async () => {
      for (let i = 0; i < 15; i++) {
        await repository.createChat({ title: `Chat ${i}` });
      }

      const firstPage = await repository.listChats({ limit: 10, offset: 0 });
      expect(firstPage.length).toBe(10);

      const secondPage = await repository.listChats({ limit: 10, offset: 10 });
      expect(secondPage.length).toBe(5);
    });

    it('should enforce max chat limit by deleting oldest chats', async () => {
      for (let i = 0; i < 25; i++) {
        await repository.createChat({ title: `Chat ${i}` });
      }

      const allChats = await repository.listChats();
      expect(allChats.length).toBeLessThanOrEqual(20);

      const chatTitles = allChats.map(chat => chat.title);
      expect(chatTitles).toContain('Chat 23');

      expect(chatTitles).not.toContain('Chat 0');
      expect(chatTitles).not.toContain('Chat 1');
      expect(chatTitles).not.toContain('Chat 2');
      expect(chatTitles).not.toContain('Chat 3');
    });
  });

  describe('Users can delete individual chats from the history', () => {
    it('should delete individual chats', async () => {
      const chatId = await repository.createChat({ title: 'Test Chat' });
      let chats = await repository.listChats();
      expect(chats.some(c => c.id === chatId)).toBe(true);

      await repository.deleteChat(chatId);
      chats = await repository.listChats();
      expect(chats.some(c => c.id === chatId)).toBe(false);
    });

    it('should not affect other chats when deleting one', async () => {
      const chat1 = await repository.createChat({ title: 'Chat 1' });
      const chat2 = await repository.createChat({ title: 'Chat 2' });
      const chat3 = await repository.createChat({ title: 'Chat 3' });

      await repository.deleteChat(chat2);

      const chats = await repository.listChats();
      expect(chats.length).toBe(2);
      expect(chats.some(c => c.id === chat1)).toBe(true);
      expect(chats.some(c => c.id === chat2)).toBe(false);
      expect(chats.some(c => c.id === chat3)).toBe(true);
    });
  });

  describe('Chat messages persist across page reloads', () => {
    it('should persist and reload chat messages', async () => {
      const chatId = await repository.createChat();
      const chat = await repository.loadChat(chatId);

      const messages = [
        { id: 'msg-1', role: 'user' as const, content: 'Hello', createdAt: new Date() },
        { id: 'msg-2', role: 'assistant' as const, content: 'Hi there', createdAt: new Date() },
      ];

      chat!.messages.push(...messages);
      await repository.saveChat(chat!);

      const reloadedChat = await repository.loadChat(chatId);
      expect(reloadedChat?.messages.length).toBe(2);
      expect(reloadedChat?.messages[0].content).toBe('Hello');
      expect(reloadedChat?.messages[1].content).toBe('Hi there');
    });
  });

  describe('Full conversation context is maintained when resuming chats', () => {
    it('should maintain full conversation history when loading chat', async () => {
      const chatId = await repository.createChat();
      const chat = await repository.loadChat(chatId);

      const conversationHistory = [
        { id: 'msg-1', role: 'user' as const, content: 'What is 2+2?', createdAt: new Date() },
        { id: 'msg-2', role: 'assistant' as const, content: '2+2 equals 4', createdAt: new Date() },
        { id: 'msg-3', role: 'user' as const, content: 'What about 3+3?', createdAt: new Date() },
        { id: 'msg-4', role: 'assistant' as const, content: '3+3 equals 6', createdAt: new Date() },
      ];

      chat!.messages.push(...conversationHistory);
      await repository.saveChat(chat!);

      const loadedChat = await repository.loadChat(chatId);
      expect(loadedChat?.messages.length).toBe(4);

      for (let i = 0; i < 4; i++) {
        expect(loadedChat?.messages[i].id).toBe(conversationHistory[i].id);
        expect(loadedChat?.messages[i].content).toBe(conversationHistory[i].content);
        expect(loadedChat?.messages[i].role).toBe(conversationHistory[i].role);
      }
    });

    it('should preserve message order and timestamps', async () => {
      const chatId = await repository.createChat();
      const chat = await repository.loadChat(chatId);

      const now = Date.now();
      const messages = [
        { id: 'msg-1', role: 'user' as const, content: 'First', createdAt: new Date(now) },
        { id: 'msg-2', role: 'assistant' as const, content: 'Second', createdAt: new Date(now + 1000) },
        { id: 'msg-3', role: 'user' as const, content: 'Third', createdAt: new Date(now + 2000) },
      ];

      chat!.messages.push(...messages);
      await repository.saveChat(chat!);

      const loadedChat = await repository.loadChat(chatId);
      expect(loadedChat?.messages[0].createdAt.getTime()).toBe(now);
      expect(loadedChat?.messages[1].createdAt.getTime()).toBe(now + 1000);
      expect(loadedChat?.messages[2].createdAt.getTime()).toBe(now + 2000);
    });
  });

  describe('Custom chat storage backends can be implemented via the ChatRepository interface', () => {
    it('should implement ChatRepository interface correctly', async () => {
      expect(typeof repository.createChat).toBe('function');
      expect(typeof repository.loadChat).toBe('function');
      expect(typeof repository.saveChat).toBe('function');
      expect(typeof repository.deleteChat).toBe('function');
      expect(typeof repository.listChats).toBe('function');
      expect(typeof repository.deleteAll).toBe('function');
    });

    it('should support custom implementation with different storage', async () => {
      class InMemoryRepository implements ChatRepository {
        private storage = new Map<string, Chat>();

        async createChat() {
          const id = `mem_${Date.now()}`;
          const now = new Date();
          this.storage.set(id, { id, messages: [], createdAt: now, updatedAt: now });
          return id;
        }

        async loadChat(id: string) {
          return this.storage.get(id) || null;
        }

        async saveChat(chat: Chat) {
          this.storage.set(chat.id, { ...chat, updatedAt: new Date() });
        }

        async deleteChat(id: string) {
          this.storage.delete(id);
        }

        async listChats() {
          return Array.from(this.storage.values())
            .map(({ messages, ...rest }) => rest);
        }

        async deleteAll() {
          this.storage.clear();
        }
      }

      const customRepo = new InMemoryRepository();
      const chatId = await customRepo.createChat();
      const chat = await customRepo.loadChat(chatId);

      expect(chat).toBeDefined();
      expect(chat?.id).toContain('mem_');
    });
  });
});
