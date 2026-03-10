import { useState, useCallback, useRef, useEffect } from 'react';
import type { ChatRepository, Chat, ChatMetadata, CreateChatOptions, PersistedMessageContent, PersistedMessage, PersistedToolCall } from '../providers/chatRepository/types';
import { generateMessageId } from '../providers/chatRepository/types';
import type { UseAIClient } from '../client';
import type { Message as AGUIMessage } from '../types';
import { getTextFromContent } from '../utils/messageContent';

// Constants
const CHAT_TITLE_MAX_LENGTH = 50;

/**
 * Deep equality comparison using JSON serialization.
 * Works for JSON-serializable values (primitives, arrays, plain objects).
 */
function deepEquals(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Generates a chat title from a message, truncating if necessary.
 */
function generateChatTitle(message: string): string {
  return message.length > CHAT_TITLE_MAX_LENGTH
    ? message.substring(0, CHAT_TITLE_MAX_LENGTH) + '...'
    : message;
}

/**
 * Transforms persisted messages to AG-UI message format for loading into client.
 * Preserves toolCalls on assistant messages and toolCallId on tool messages
 * so the server can reconstruct valid API messages.
 */
function transformMessagesToClientFormat(persistedMessages: PersistedMessage[]): AGUIMessage[] {
  return persistedMessages.map((msg): AGUIMessage => {
    const textContent = getTextFromContent(msg.content);

    switch (msg.role) {
      case 'tool':
        return {
          id: msg.id,
          role: 'tool',
          content: textContent,
          toolCallId: msg.toolCallId || '',
        };
      case 'assistant':
        return {
          id: msg.id,
          role: 'assistant',
          content: textContent,
          ...(msg.toolCalls && msg.toolCalls.length > 0 ? { toolCalls: msg.toolCalls } : {}),
        };
      case 'user':
        return {
          id: msg.id,
          role: 'user',
          content: textContent,
        };
    }
  });
}

export interface UseChatManagementOptions {
  /** Chat repository for persistence */
  repository: ChatRepository;
  /** Reference to the UseAIClient (can be null during initialization) */
  clientRef: React.MutableRefObject<UseAIClient | null>;
  /** Current messages state (owned by provider) */
  messages: PersistedMessage[];
  /** Setter for messages state (owned by provider) */
  setMessages: React.Dispatch<React.SetStateAction<PersistedMessage[]>>;
  /** Whether the client is connected */
  connected?: boolean;
}

export interface UseChatManagementReturn {
  /** Current active chat ID where AI responses are saved */
  currentChatId: string | null;
  /** Chat loaded for viewing but not yet active for AI responses */
  pendingChatId: string | null;
  /** The displayed chat ID (pending or current) */
  displayedChatId: string | null;
  /** Creates a new chat and switches to it */
  createNewChat: (options?: CreateChatOptions) => Promise<string>;
  /** Loads an existing chat by ID */
  loadChat: (chatId: string) => Promise<void>;
  /** Deletes a chat by ID */
  deleteChat: (chatId: string) => Promise<void>;
  /** Lists all available chats */
  listChats: () => Promise<Array<Omit<Chat, 'messages'>>>;
  /** Clears the current chat messages */
  clearCurrentChat: () => Promise<void>;
  /** Activates the pending chat (called when user sends first message) */
  activatePendingChat: () => string | null;
  /** Saves a user message to storage and reloads messages */
  saveUserMessage: (chatId: string, content: PersistedMessageContent) => Promise<boolean>;
  /**
   * Saves an AI response to storage and optionally reloads messages.
   * When turnMessages are provided, intermediate assistant+tool messages from
   * the turn are persisted before the final assistant message, preserving the
   * complete tool call context for conversation history.
   */
  saveAIResponse: (content: string, displayMode?: 'default' | 'error', traceId?: string, turnMessages?: PersistedMessage[]) => Promise<void>;
  /** Reloads messages from storage for the given chat ID */
  reloadMessages: (chatId: string) => Promise<void>;
  /** Get the current chat object. Metadata is frozen to prevent accidental mutation. */
  getCurrentChat: () => Promise<Chat | null>;
  /** Update metadata for the current chat */
  updateMetadata: (metadata: ChatMetadata, overwrite?: boolean) => Promise<void>;
  /** Snapshot refs for use in event handlers */
  currentChatIdSnapshot: React.MutableRefObject<string | null>;
  pendingChatIdSnapshot: React.MutableRefObject<string | null>;
}

/**
 * Hook for managing chat lifecycle operations.
 *
 * Features:
 * - Creates, loads, deletes chats
 * - Manages pending/active chat state machine
 * - Saves user messages and AI responses
 * - Auto-generates chat titles
 * - Initializes with most recent chat or creates new one
 */
export function useChatManagement({
  repository,
  clientRef,
  messages,
  setMessages,
  connected,
}: UseChatManagementOptions): UseChatManagementReturn {
  /**
   * Current active chat where AI responses are saved.
   * This is the "source of truth" for where new AI messages get persisted.
   */
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);

  /**
   * Chat loaded for viewing but not yet active for AI responses.
   * Becomes currentChatId when user sends their first message.
   * This prevents race conditions when AI is still responding to the previous chat.
   */
  const [pendingChatId, setPendingChatId] = useState<string | null>(null);

  /**
   * Snapshot refs to capture latest chat IDs in event handler closures.
   * Event handlers are created once during mount and don't see updated state values.
   * These refs are kept in sync with state via useEffect to provide access to current values.
   */
  const currentChatIdSnapshot = useRef<string | null>(null);
  const pendingChatIdSnapshot = useRef<string | null>(null);

  // Keep snapshot refs in sync with latest chat IDs
  useEffect(() => {
    currentChatIdSnapshot.current = currentChatId;
  }, [currentChatId]);

  useEffect(() => {
    pendingChatIdSnapshot.current = pendingChatId;
  }, [pendingChatId]);

  /** Loads messages from storage for a given chat ID. */
  const loadChatMessages = useCallback(async (chatId: string): Promise<PersistedMessage[]> => {
    try {
      const chat = await repository.loadChat(chatId);
      if (chat) {
        console.log('[ChatManagement] Loaded', chat.messages.length, 'messages from storage for chat:', chatId);
        return chat.messages;
      } else {
        console.log('[ChatManagement] Chat not found in storage:', chatId);
        return [];
      }
    } catch (error) {
      console.error('[ChatManagement] Failed to load chat messages:', error);
      return [];
    }
  }, [repository]);

  /** Reloads messages from storage and updates state. */
  const reloadMessages = useCallback(async (chatId: string) => {
    const loadedMessages = await loadChatMessages(chatId);
    setMessages(loadedMessages);
  }, [loadChatMessages, setMessages]);

  /** Creates a new chat. */
  const createNewChat = useCallback(async (options?: CreateChatOptions): Promise<string> => {
    console.log('[ChatManagement] createNewChat called - currentChatId:', currentChatId, 'pendingChatId:', pendingChatId, 'messages.length:', messages.length);

    // Reuse last created blank chat if options match
    if (pendingChatId && messages.length === 0) {
      const existingChat = await repository.loadChat(pendingChatId);
      const optionsMatch = existingChat
        && existingChat.title === options?.title
        && deepEquals(existingChat.metadata, options?.metadata);
      if (optionsMatch) {
        console.log('[ChatManagement] Last created chat has matching options, reusing:', pendingChatId);
        return pendingChatId;
      }
    }

    console.log('[ChatManagement] Creating new chat...');
    const chatId = await repository.createChat(options);

    // Set as pending - don't switch currentChatId until user sends a message
    setPendingChatId(chatId);
    setMessages([]);

    // Set threadId to new chatId to ensure clean conversation state
    if (clientRef.current) {
      clientRef.current.setThreadId(chatId);
      console.log('[ChatManagement] Set threadId to new chatId:', chatId);
    }

    console.log('[ChatManagement] Created pending chat:', chatId, '(will activate on first message)');
    return chatId;
  }, [currentChatId, pendingChatId, messages, repository, clientRef, setMessages]);

  /** Loads an existing chat by ID. */
  const loadChat = useCallback(async (chatId: string): Promise<void> => {
    // Set as pending chat - don't activate until user sends a message
    setPendingChatId(chatId);
    await reloadMessages(chatId);

    // Set threadId so the server recognizes this as a different conversation
    if (clientRef.current) {
      clientRef.current.setThreadId(chatId);
      console.log('[ChatManagement] Set threadId to chatId:', chatId);
    }

    console.log('[ChatManagement] Loaded pending chat:', chatId, '(will activate on first message)');
  }, [reloadMessages, clientRef]);

  /** Deletes a chat by ID. */
  const deleteChat = useCallback(async (chatId: string): Promise<void> => {
    await repository.deleteChat(chatId);

    if (currentChatId === chatId) {
      setCurrentChatId(null);
      setMessages([]);
    }

    if (pendingChatId === chatId) {
      setPendingChatId(null);
      setMessages([]);
    }

    console.log('[ChatManagement] Deleted chat:', chatId);
  }, [currentChatId, pendingChatId, repository, setMessages]);

  /** Lists all available chats. */
  const listChats = useCallback(async (): Promise<Array<Omit<Chat, 'messages'>>> => {
    return await repository.listChats();
  }, [repository]);

  /** Clears the current chat messages. */
  const clearCurrentChat = useCallback(async (): Promise<void> => {
    setMessages([]);

    if (currentChatId) {
      const chat = await repository.loadChat(currentChatId);
      if (chat) {
        chat.messages = [];
        await repository.saveChat(chat);
        console.log('[ChatManagement] Cleared current chat:', currentChatId);
      }
    }
  }, [currentChatId, repository, setMessages]);

  /**
   * Gets the current chat object (including metadata).
   * Metadata is frozen to prevent accidental mutation.
   */
  const getCurrentChat = useCallback(async (): Promise<Chat | null> => {
    const chatId = pendingChatId || currentChatId;
    if (!chatId) return null;
    const chat = await repository.loadChat(chatId);
    if (chat?.metadata) {
      chat.metadata = Object.freeze({ ...chat.metadata });
    }
    return chat;
  }, [pendingChatId, currentChatId, repository]);

  /** Updates metadata for the current chat. */
  const updateMetadata = useCallback(async (metadata: ChatMetadata, overwrite = false): Promise<void> => {
    const chatId = pendingChatId || currentChatId;
    if (!chatId) {
      throw new Error('No active chat');
    }
    await repository.updateMetadata(chatId, metadata, overwrite);
  }, [pendingChatId, currentChatId, repository]);

  /**
   * Activates the pending chat (called when user sends first message).
   * Returns the activated chat ID, or null if no pending chat.
   */
  const activatePendingChat = useCallback((): string | null => {
    if (!pendingChatId) return null;

    console.log('[ChatManagement] Activating pending chat:', pendingChatId);

    // Load existing messages into client for conversation history
    if (clientRef.current && messages.length > 0) {
      clientRef.current.loadMessages(transformMessagesToClientFormat(messages));
      console.log('[ChatManagement] Loaded', messages.length, 'existing messages into client');
    }

    setCurrentChatId(pendingChatId);
    setPendingChatId(null);

    return pendingChatId;
  }, [pendingChatId, clientRef, messages]);

  /** Saves a user message to storage. */
  const saveUserMessage = useCallback(async (
    chatId: string,
    content: PersistedMessageContent
  ): Promise<boolean> => {
    try {
      const chat = await repository.loadChat(chatId);

      if (!chat) {
        console.error('[ChatManagement] Chat not found:', chatId);
        return false;
      }

      const newMessage: PersistedMessage = {
        id: generateMessageId(),
        role: 'user',
        content,
        createdAt: new Date(),
      };
      chat.messages.push(newMessage);

      // Auto-generate title from text content
      if (!chat.title) {
        const text = getTextFromContent(content);
        if (text) {
          chat.title = generateChatTitle(text);
        }
      }

      await repository.saveChat(chat);
      console.log('[ChatManagement] Saved user message to storage');

      // Append to local state directly (no reload round-trip)
      setMessages(prev => [...prev, newMessage]);
      return true;
    } catch (error) {
      console.error('[ChatManagement] Failed to save user message:', error);
      return false;
    }
  }, [repository, setMessages]);

  /** Saves an AI response to storage and updates UI. */
  const saveAIResponse = useCallback(async (
    content: string,
    displayMode?: 'default' | 'error',
    traceId?: string,
    turnMessages?: PersistedMessage[]
  ): Promise<void> => {
    const currentChatIdValue = currentChatIdSnapshot.current;
    const pendingChatIdValue = pendingChatIdSnapshot.current;
    const displayedChatId = pendingChatIdValue || currentChatIdValue;

    if (!currentChatIdValue) {
      console.warn('[ChatManagement] No current chat ID, cannot save AI response');
      return;
    }

    try {
      const chat = await repository.loadChat(currentChatIdValue);

      if (!chat) {
        console.error('[ChatManagement] Chat not found:', currentChatIdValue);
        return;
      }

      // Save intermediate turn messages (assistant messages with tool calls,
      // and tool result messages) before the final assistant message.
      if (turnMessages && turnMessages.length > 0) {
        chat.messages.push(...turnMessages);
      }

      const finalMessage: PersistedMessage = {
        id: generateMessageId(),
        role: 'assistant',
        content,
        createdAt: new Date(),
        displayMode,
        traceId,
      };
      chat.messages.push(finalMessage);

      // Auto-generate title from first user message if not set
      if (!chat.title) {
        const firstUserMessage = chat.messages.find(msg => msg.role === 'user');
        if (firstUserMessage) {
          const textContent = getTextFromContent(firstUserMessage.content);
          if (textContent) {
            chat.title = generateChatTitle(textContent);
          }
        }
      }

      await repository.saveChat(chat);
      console.log('[ChatManagement] Saved AI response to storage for chatId:', currentChatIdValue);

      // Append to local state directly if user is viewing this chat (no reload round-trip)
      if (displayedChatId === currentChatIdValue) {
        const newMessages: PersistedMessage[] = [
          ...(turnMessages ?? []),
          finalMessage,
        ];
        setMessages(prev => [...prev, ...newMessages]);
      }
    } catch (error) {
      console.error('[ChatManagement] Failed to save AI response:', error);
    }
  }, [repository, setMessages]);

  // Initialize: load most recent chat or create new one on mount
  const initializedRef = useRef(false);
  useEffect(() => {
    // Only initialize if we don't have any chat (neither current nor pending)
    if (currentChatId === null && pendingChatId === null && !initializedRef.current) {
      initializedRef.current = true;

      (async () => {
        try {
          const chats = await repository.listChats({ limit: 1 });

          if (chats.length > 0) {
            // Load the most recent chat and activate it immediately (no AI response in progress at startup)
            const mostRecentChatId = chats[0].id;
            console.log('[ChatManagement] Loading most recent chat on mount:', mostRecentChatId);
            const loadedMessages = await loadChatMessages(mostRecentChatId);

            setCurrentChatId(mostRecentChatId);
            setMessages(loadedMessages);

            // Load into client for conversation history and set threadId
            if (clientRef.current) {
              clientRef.current.setThreadId(mostRecentChatId);
              clientRef.current.loadMessages(transformMessagesToClientFormat(loadedMessages));
              console.log('[ChatManagement] Set threadId and loaded messages for chat:', mostRecentChatId);
            }

            console.log('[ChatManagement] Loaded and activated chat on mount:', mostRecentChatId);
          } else {
            // No chats exist, create a new one (will be pending until first message)
            console.log('[ChatManagement] No existing chats, creating new one');
            await createNewChat();
          }
        } catch (err) {
          console.error('[ChatManagement] Failed to initialize chat:', err);
          initializedRef.current = false; // Reset on error so it can retry
        }
      })();
    }
  }, [currentChatId, pendingChatId, createNewChat, repository, loadChatMessages, clientRef, setMessages]);

  // Reload messages from storage on reconnection.
  // After a server restart, the client's in-memory _messages may have tool
  // results ordered before their parent assistant messages (because tool results
  // are pushed during execution while assistant messages are pushed at
  // RUN_FINISHED). Storage has the correct ordering from extractTurnMessages.
  const connectionPhaseRef = useRef<'initial' | 'connected' | 'disconnected'>('initial');

  useEffect(() => {
    if (connected) {
      const isReconnect = connectionPhaseRef.current === 'disconnected';
      connectionPhaseRef.current = 'connected';

      if (isReconnect && currentChatId && clientRef.current) {
        (async () => {
          const loadedMessages = await loadChatMessages(currentChatId);
          if (loadedMessages.length > 0) {
            clientRef.current?.loadMessages(transformMessagesToClientFormat(loadedMessages));
            console.log('[ChatManagement] Reloaded', loadedMessages.length, 'messages from storage on reconnect');
          }
        })();
      }
    } else {
      if (connectionPhaseRef.current === 'connected') {
        connectionPhaseRef.current = 'disconnected';
      }
    }
  }, [connected, currentChatId, loadChatMessages, clientRef]);

  // The displayed chat ID is the pending chat (if any) or the current active chat
  const displayedChatId = pendingChatId || currentChatId;

  return {
    currentChatId,
    pendingChatId,
    displayedChatId,
    createNewChat,
    loadChat,
    deleteChat,
    listChats,
    clearCurrentChat,
    activatePendingChat,
    saveUserMessage,
    saveAIResponse,
    reloadMessages,
    getCurrentChat,
    updateMetadata,
    currentChatIdSnapshot,
    pendingChatIdSnapshot,
  };
}
