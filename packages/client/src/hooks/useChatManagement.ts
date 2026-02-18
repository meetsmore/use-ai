import { useState, useCallback, useRef, useEffect } from 'react';
import type { ChatRepository, Chat, ChatMetadata, CreateChatOptions, PersistedMessageContent } from '../providers/chatRepository/types';
import type { Message } from '../components/UseAIChatPanel';
import type { UseAIClient } from '../client';
import type { Message as AGUIMessage } from '../types';

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
 * Extracts text content from persisted message content.
 */
function getTextFromContent(content: PersistedMessageContent): string {
  if (typeof content === 'string') {
    return content;
  }
  return content
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map(part => part.text)
    .join('\n');
}

/**
 * Transforms storage messages to UI message format.
 */
function transformMessagesToUI(
  storageMessages: Array<{
    id: string;
    role: string;
    content: PersistedMessageContent;
    createdAt: Date;
    displayMode?: 'default' | 'error';
    traceId?: string;
    feedback?: 'upvote' | 'downvote' | null;
  }>
): Message[] {
  return storageMessages.map((msg) => ({
    id: msg.id,
    role: msg.role as 'user' | 'assistant',
    content: msg.content,
    timestamp: msg.createdAt,
    displayMode: msg.displayMode,
    traceId: msg.traceId,
    feedback: msg.feedback,
  }));
}

/**
 * Transforms UI messages to AG-UI message format for loading into client.
 */
function transformMessagesToClientFormat(uiMessages: Message[]): AGUIMessage[] {
  return uiMessages.map((msg) => {
    const textContent = getTextFromContent(msg.content);
    return {
      id: msg.id,
      role: msg.role,
      content: textContent,
    };
  });
}

export interface UseChatManagementOptions {
  /** Chat repository for persistence */
  repository: ChatRepository;
  /** Reference to the UseAIClient (can be null during initialization) */
  clientRef: React.MutableRefObject<UseAIClient | null>;
  /** Current messages state (owned by provider) */
  messages: Message[];
  /** Setter for messages state (owned by provider) */
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
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
  /** Saves an AI response to storage and optionally reloads messages */
  saveAIResponse: (content: string, displayMode?: 'default' | 'error', traceId?: string) => Promise<void>;
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
   */
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);

  /**
   * Chat loaded for viewing but not yet active for AI responses.
   * Becomes currentChatId when user sends their first message.
   */
  const [pendingChatId, setPendingChatId] = useState<string | null>(null);

  /**
   * Snapshot refs to capture latest chat IDs in event handler closures.
   */
  const currentChatIdSnapshot = useRef<string | null>(null);
  const pendingChatIdSnapshot = useRef<string | null>(null);

  useEffect(() => {
    currentChatIdSnapshot.current = currentChatId;
  }, [currentChatId]);

  useEffect(() => {
    pendingChatIdSnapshot.current = pendingChatId;
  }, [pendingChatId]);

  const loadChatMessages = useCallback(async (chatId: string): Promise<Message[]> => {
    try {
      const chat = await repository.loadChat(chatId);
      if (chat) {
        const loadedMessages = transformMessagesToUI(chat.messages);
        console.log('[ChatManagement] Loaded', loadedMessages.length, 'messages from storage for chat:', chatId);
        return loadedMessages;
      } else {
        console.log('[ChatManagement] Chat not found in storage:', chatId);
        return [];
      }
    } catch (error) {
      console.error('[ChatManagement] Failed to load chat messages:', error);
      return [];
    }
  }, [repository]);

  const reloadMessages = useCallback(async (chatId: string) => {
    const loadedMessages = await loadChatMessages(chatId);
    setMessages(loadedMessages);
  }, [loadChatMessages, setMessages]);

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

    setPendingChatId(chatId);
    setMessages([]);

    if (clientRef.current) {
      clientRef.current.setThreadId(chatId);
      console.log('[ChatManagement] Set threadId to new chatId:', chatId);
    }

    console.log('[ChatManagement] Created pending chat:', chatId, '(will activate on first message)');
    return chatId;
  }, [currentChatId, pendingChatId, messages, repository, clientRef, setMessages]);

  const loadChat = useCallback(async (chatId: string): Promise<void> => {
    setPendingChatId(chatId);
    await reloadMessages(chatId);

    if (clientRef.current) {
      clientRef.current.setThreadId(chatId);
      console.log('[ChatManagement] Set threadId to chatId:', chatId);
    }

    console.log('[ChatManagement] Loaded pending chat:', chatId, '(will activate on first message)');
  }, [reloadMessages, clientRef]);

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

  const listChats = useCallback(async (): Promise<Array<Omit<Chat, 'messages'>>> => {
    return await repository.listChats();
  }, [repository]);

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

  const getCurrentChat = useCallback(async (): Promise<Chat | null> => {
    const chatId = pendingChatId || currentChatId;
    if (!chatId) return null;
    const chat = await repository.loadChat(chatId);
    if (chat?.metadata) {
      chat.metadata = Object.freeze({ ...chat.metadata });
    }
    return chat;
  }, [pendingChatId, currentChatId, repository]);

  const updateMetadata = useCallback(async (metadata: ChatMetadata, overwrite = false): Promise<void> => {
    const chatId = pendingChatId || currentChatId;
    if (!chatId) {
      throw new Error('No active chat');
    }
    await repository.updateMetadata(chatId, metadata, overwrite);
  }, [pendingChatId, currentChatId, repository]);

  const activatePendingChat = useCallback((): string | null => {
    if (!pendingChatId) return null;

    console.log('[ChatManagement] Activating pending chat:', pendingChatId);

    if (clientRef.current && messages.length > 0) {
      clientRef.current.loadMessages(transformMessagesToClientFormat(messages));
      console.log('[ChatManagement] Loaded', messages.length, 'existing messages into client');
    }

    setCurrentChatId(pendingChatId);
    setPendingChatId(null);

    return pendingChatId;
  }, [pendingChatId, messages, clientRef]);

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

      const { generateMessageId } = await import('../providers/chatRepository/types');
      chat.messages.push({
        id: generateMessageId(),
        role: 'user',
        content,
        createdAt: new Date(),
      });

      if (!chat.title) {
        const text = getTextFromContent(content);
        if (text) {
          chat.title = generateChatTitle(text);
        }
      }

      await repository.saveChat(chat);
      console.log('[ChatManagement] Saved user message to storage');

      await reloadMessages(chatId);
      return true;
    } catch (error) {
      console.error('[ChatManagement] Failed to save user message:', error);
      return false;
    }
  }, [repository, reloadMessages]);

  const saveAIResponse = useCallback(async (
    content: string,
    displayMode?: 'default' | 'error',
    traceId?: string
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

      const { generateMessageId } = await import('../providers/chatRepository/types');
      chat.messages.push({
        id: generateMessageId(),
        role: 'assistant',
        content,
        createdAt: new Date(),
        displayMode,
        traceId,
      });

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

      if (displayedChatId === currentChatIdValue) {
        await reloadMessages(currentChatIdValue);
      }
    } catch (error) {
      console.error('[ChatManagement] Failed to save AI response:', error);
    }
  }, [repository, reloadMessages]);

  // Initialize: load most recent chat or create new one on mount
  const initializedRef = useRef(false);
  useEffect(() => {
    if (currentChatId === null && pendingChatId === null && !initializedRef.current) {
      initializedRef.current = true;

      (async () => {
        try {
          const chats = await repository.listChats({ limit: 1 });

          if (chats.length > 0) {
            const mostRecentChatId = chats[0].id;
            console.log('[ChatManagement] Loading most recent chat on mount:', mostRecentChatId);
            const loadedMessages = await loadChatMessages(mostRecentChatId);

            setCurrentChatId(mostRecentChatId);
            setMessages(loadedMessages);

            if (clientRef.current) {
              clientRef.current.setThreadId(mostRecentChatId);
              clientRef.current.loadMessages(transformMessagesToClientFormat(loadedMessages));
              console.log('[ChatManagement] Set threadId and loaded messages for chat:', mostRecentChatId);
            }

            console.log('[ChatManagement] Loaded and activated chat on mount:', mostRecentChatId);
          } else {
            console.log('[ChatManagement] No existing chats, creating new one');
            await createNewChat();
          }
        } catch (err) {
          console.error('[ChatManagement] Failed to initialize chat:', err);
          initializedRef.current = false;
        }
      })();
    }
  }, [currentChatId, pendingChatId, createNewChat, repository, loadChatMessages, clientRef, setMessages]);

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
