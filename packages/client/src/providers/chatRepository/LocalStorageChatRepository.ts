import type {
  Chat,
  ChatRepository,
  CreateChatOptions,
  ListChatsOptions,
} from './types';
import { generateChatId } from './types';

const STORAGE_KEY_PREFIX = 'use-ai:chat:';
const STORAGE_INDEX_KEY = 'use-ai:chat-index';
const MAX_CHATS = 20;

/**
 * LocalStorage-based implementation of ChatRepository.
 * Stores chats in browser `localStorage`.
 *
 * Storage structure:
 * - `use-ai:chat-index`: Array of chat IDs
 * - `use-ai:chat:{id}`: Individual chat data
 *
 * Storage limit: Only the most recent 20 chats are kept by default.
 * When creating a new chat, the oldest chat (by updatedAt) is automatically deleted if the limit is reached.
 *
 * @example
 * ```typescript
 * // Use default 20-chat limit
 * const repository = new LocalStorageChatRepository();
 *
 * // Customize max chats limit
 * const repository = new LocalStorageChatRepository(localStorage, 50);
 * ```
 */
export class LocalStorageChatRepository implements ChatRepository {
  private storage: Storage;
  private maxChats: number;

  /**
   * Creates a new LocalStorageChatRepository.
   *
   * @param storage - Storage implementation to use (defaults to browser `localStorage`)
   * @param maxChats - Maximum number of chats to keep (defaults to 20). Oldest chats are automatically deleted when this limit is exceeded.
   */
  constructor(storage: Storage = localStorage, maxChats: number = MAX_CHATS) {
    this.storage = storage;
    this.maxChats = maxChats;
  }

  async createChat(options?: CreateChatOptions): Promise<string> {
    const id = generateChatId();
    const now = new Date();

    const chat: Chat = {
      id,
      title: options?.title,
      messages: [],
      createdAt: now,
      updatedAt: now,
    };

    // Enforce max chats limit by deleting oldest chat if needed
    await this.enforceMaxChatsLimit();

    await this.saveChat(chat);
    await this.addToIndex(id);

    return id;
  }

  async loadChat(id: string): Promise<Chat | null> {
    try {
      const key = this.getChatKey(id);
      const data = this.storage.getItem(key);

      if (!data) {
        return null;
      }

      const chat = JSON.parse(data) as Chat;

      // Deserialize dates
      chat.createdAt = new Date(chat.createdAt);
      chat.updatedAt = new Date(chat.updatedAt);
      chat.messages = chat.messages.map((msg) => ({
        ...msg,
        createdAt: new Date(msg.createdAt),
      }));

      return chat;
    } catch (error) {
      console.error(`Failed to load chat ${id}:`, error);
      return null;
    }
  }

  async saveChat(chat: Chat): Promise<void> {
    try {
      const key = this.getChatKey(chat.id);
      const data = JSON.stringify({
        ...chat,
        updatedAt: new Date(),
      });

      this.storage.setItem(key, data);
    } catch (error) {
      console.error(`Failed to save chat ${chat.id}:`, error);
      throw new Error(`Failed to save chat: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async deleteChat(id: string): Promise<void> {
    try {
      const key = this.getChatKey(id);
      this.storage.removeItem(key);
      await this.removeFromIndex(id);
    } catch (error) {
      console.error(`Failed to delete chat ${id}:`, error);
      throw new Error(`Failed to delete chat: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async listChats(
    options?: ListChatsOptions
  ): Promise<Array<Omit<Chat, 'messages'>>> {
    try {
      const ids = await this.getIndex();
      const chats: Array<Omit<Chat, 'messages'>> = [];

      for (const id of ids) {
        const chat = await this.loadChat(id);
        if (chat) {
          const { messages, ...metadata } = chat;
          chats.push(metadata);
        }
      }

      // Sort by updatedAt descending (most recent first)
      chats.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

      // Apply pagination
      const { limit, offset = 0 } = options ?? {};
      const start = offset;
      const end = limit ? offset + limit : undefined;

      return chats.slice(start, end);
    } catch (error) {
      console.error('Failed to list chats:', error);
      return [];
    }
  }

  async deleteAll(): Promise<void> {
    try {
      const ids = await this.getIndex();

      for (const id of ids) {
        const key = this.getChatKey(id);
        this.storage.removeItem(key);
      }

      this.storage.removeItem(STORAGE_INDEX_KEY);
    } catch (error) {
      console.error('Failed to clear all chats:', error);
      throw new Error(`Failed to clear all chats: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private getChatKey(id: string): string {
    return `${STORAGE_KEY_PREFIX}${id}`;
  }

  private async getIndex(): Promise<string[]> {
    try {
      const data = this.storage.getItem(STORAGE_INDEX_KEY);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error('Failed to load chat index:', error);
      return [];
    }
  }

  private async addToIndex(id: string): Promise<void> {
    const index = await this.getIndex();
    if (!index.includes(id)) {
      index.push(id);
      this.storage.setItem(STORAGE_INDEX_KEY, JSON.stringify(index));
    }
  }

  private async removeFromIndex(id: string): Promise<void> {
    const index = await this.getIndex();
    const filtered = index.filter((chatId) => chatId !== id);
    this.storage.setItem(STORAGE_INDEX_KEY, JSON.stringify(filtered));
  }

  private async enforceMaxChatsLimit(): Promise<void> {
    const chats = await this.listChats();

    if (chats.length >= this.maxChats) {
      // Sort by updatedAt ascending to find oldest
      const sortedChats = [...chats].sort(
        (a, b) => a.updatedAt.getTime() - b.updatedAt.getTime()
      );

      // Delete the oldest chat(s) to make room
      const numToDelete = chats.length - this.maxChats + 1;
      for (let i = 0; i < numToDelete; i++) {
        await this.deleteChat(sortedChats[i].id);
      }
    }
  }
}
