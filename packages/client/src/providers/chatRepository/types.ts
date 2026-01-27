import type { PersistedFileMetadata } from '../../fileUpload/types';
import type { FeedbackValue } from '@meetsmore-oss/use-ai-core';

/**
 * Display mode for chat messages.
 * Determines the visual styling of the message bubble.
 */
export type MessageDisplayMode = 'default' | 'error';

/**
 * Text content part for persisted messages.
 */
export interface PersistedTextContent {
  type: 'text';
  text: string;
}

/**
 * File content part for persisted messages.
 * Only stores metadata, not the actual file data.
 */
export interface PersistedFileContent {
  type: 'file';
  file: PersistedFileMetadata;
}

/**
 * Content part for persisted messages.
 * Can be text or file metadata.
 */
export type PersistedContentPart = PersistedTextContent | PersistedFileContent;

/**
 * Content that can be persisted.
 * Simple string for text-only messages, or array for multimodal content.
 */
export type PersistedMessageContent = string | PersistedContentPart[];

/**
 * Message format for persisted chat history.
 * Compatible with AI SDK's UIMessage format for future integration.
 */
export interface PersistedMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  /** Content can be a string or multimodal content array */
  content: PersistedMessageContent;
  createdAt: Date;
  displayMode?: MessageDisplayMode;
  /** Langfuse trace ID for feedback tracking (only for assistant messages) */
  traceId?: string;
  /** User feedback on this message (only for assistant messages) */
  feedback?: FeedbackValue;
}

/**
 * Represents a stored chat conversation.
 */
export interface Chat {
  id: string;
  title?: string;
  messages: PersistedMessage[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Options for creating a new chat.
 */
export interface CreateChatOptions {
  title?: string;
}

/**
 * Options for listing chats.
 */
export interface ListChatsOptions {
  limit?: number;
  offset?: number;
}

/**
 * Abstract repository interface for chat persistence.
 * Implementations can store chats locally (localStorage, IndexedDB)
 * or remotely (REST API, GraphQL, etc.)
 */
export interface ChatRepository {
  /**
   * Creates a new chat and returns its ID.
   * @param options Optional configuration for the new chat
   * @returns Promise resolving to the new chat ID
   */
  createChat(options?: CreateChatOptions): Promise<string>;

  /**
   * Loads a chat by ID.
   * @param id Chat ID to load
   * @returns Promise resolving to the chat, or null if not found
   */
  loadChat(id: string): Promise<Chat | null>;

  /**
   * Saves or updates a chat.
   * @param chat Chat to save
   * @returns Promise resolving when save is complete
   */
  saveChat(chat: Chat): Promise<void>;

  /**
   * Deletes a chat by ID.
   * @param id Chat ID to delete
   * @returns Promise resolving when deletion is complete
   */
  deleteChat(id: string): Promise<void>;

  /**
   * Lists all available chats (metadata only, without full message history).
   * @param options Optional pagination and filtering options
   * @returns Promise resolving to array of chat metadata
   */
  listChats(options?: ListChatsOptions): Promise<Array<Omit<Chat, 'messages'>>>;

  /**
   * Deletes all stored chats.
   * @returns Promise resolving when all chats are deleted
   */
  deleteAll(): Promise<void>;
}

/**
 * Generates a unique chat ID.
 */
export function generateChatId(): string {
  return `chat_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Generates a unique message ID.
 */
export function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
