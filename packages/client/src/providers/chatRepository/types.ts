import type { PersistedFileMetadata } from '../../fileUpload/types';
import type { FeedbackValue, ReasoningPart } from '@meetsmore-oss/use-ai-core';

/**
 * Arbitrary metadata attached to a chat.
 * Use this to store context about the chat (e.g., how it was invoked, document type being processed).
 */
export type ChatMetadata = Record<string, unknown>;

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
 * Transformed file content part for persisted messages.
 * Stores the text produced by a client-side FileTransformer (e.g. OCR result)
 * so the full context survives a page reload / Socket.IO reconnect.
 */
export interface PersistedTransformedFileContent {
  type: 'transformed_file';
  /** The transformed text representation (e.g. OCR'd markdown). */
  text: string;
  originalFile: PersistedFileMetadata;
}

/**
 * Stored file content part for persisted messages.
 *
 * Unlike {@link PersistedFileContent} (metadata only, discarded on reload), this part
 * holds a `ref` into persistent storage (e.g. an S3 key). This lets attachments be
 * re-sent to the AI even after a page reload. The actual bytes live in storage rather
 * than localStorage, and the ref is resolved on the host before the next run.
 *
 * On reload it is read two ways: as a name/size chip for display, and as a re-sendable
 * `{ type: 'image_ref' | 'file_ref', ref }` wire part (see `messageConversion.ts`).
 */
export interface PersistedStoredFileContent {
  type: 'stored_file';
  /** Ref into persistent storage (e.g. an S3 key). Never expires. */
  ref: string;
  /** Original file name (for display). */
  name: string;
  /** MIME type, e.g. 'image/jpeg' | 'application/pdf'. Decides whether to re-send as image or file. */
  mimeType: string;
  /** Byte size after client-side resize (for display). */
  size: number;
}

/**
 * Content part for persisted messages.
 * One of: text, file metadata, transformed file content, or a stored (ref-backed) file.
 */
export type PersistedContentPart =
  | PersistedTextContent
  | PersistedFileContent
  | PersistedTransformedFileContent
  | PersistedStoredFileContent;

/**
 * Content that can be persisted.
 * Simple string for text-only messages, or array for multimodal content.
 */
export type PersistedMessageContent = string | PersistedContentPart[];

/**
 * Message format for persisted chat history.
 * Compatible with AI SDK's UIMessage format for future integration.
 */
/**
 * Tool call entry on an assistant message.
 * Matches the AG-UI MessageToolCall format.
 */
export interface PersistedToolCall {
  /** @example "toolu_01abc123" */
  id: string;
  type: 'function';
  function: {
    name: string;
    /** JSON-serialized arguments */
    arguments: string;
  };
  /**
   * Encrypted reasoning context for multi-turn preservation.
   * JSON-serialized provider metadata (e.g., Gemini's thoughtSignature).
   * Required for Gemini models where thoughtSignature must be sent back
   * on both tool-call and tool-result parts in subsequent turns.
   */
  encryptedValue?: string;
}

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
  /** Tool calls made by the assistant in this message (only for assistant messages) */
  toolCalls?: PersistedToolCall[];
  /**
   * ID of the tool call this message is a result of (only for tool messages)
   * @example "toolu_01abc123"
   */
  toolCallId?: string;
  /**
   * Reasoning parts from extended thinking (only for assistant messages).
   * Contains reasoning text and optional encrypted value for state continuity.
   */
  reasoningParts?: ReasoningPart[];
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
  /** Arbitrary metadata attached to the chat */
  metadata?: ChatMetadata;
}

/**
 * Options for creating a new chat.
 */
export interface CreateChatOptions {
  title?: string;
  /** Initial metadata for the chat */
  metadata?: ChatMetadata;
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

  /**
   * Updates metadata for a chat.
   * By default, merges with existing metadata. Set `overwrite: true` to replace entirely.
   * @param id Chat ID
   * @param metadata Metadata to set/merge
   * @param overwrite If true, replaces all metadata instead of merging
   * @returns Promise resolving when update is complete
   */
  updateMetadata(id: string, metadata: ChatMetadata, overwrite?: boolean): Promise<void>;
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
