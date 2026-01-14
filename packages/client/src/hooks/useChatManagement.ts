import { useState, useCallback, useRef, useEffect } from 'react';
import type { ChatRepository, Chat, PersistedMessageContent } from '../providers/chatRepository/types';
import type { Message } from '../components/UseAIChatPanel';
import type { UseAIClient } from '../client';
import type { Message as AGUIMessage, Citation } from '../types';

// Constants
const CHAT_TITLE_MAX_LENGTH = 50;

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
    citations?: Citation[];
  }>
): Message[] {
  return storageMessages.map((msg) => ({
    id: msg.id,
    role: msg.role as 'user' | 'assistant',
    content: msg.content,
    timestamp: msg.createdAt,
    displayMode: msg.displayMode,
    citations: msg.citations,
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
}

export interface UseChatManagementReturn {
  /** Current active chat ID where AI responses are saved */
  currentChatId: string | null;
  /** Chat loaded for viewing but not yet active for AI responses */
  pendingChatId: string | null;
  /** Current messages in the chat */
  messages: Message[];
  /** The displayed chat ID (pending or current) */
  displayedChatId: string | null;
  /** Creates a new chat and switches to it */
  createNewChat: () => Promise<string>;
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
  saveAIResponse: (content: string, displayMode?: 'default' | 'error', citations?: Citation[]) => Promise<void>;
  /** Reloads messages from storage for the given chat ID */
  reloadMessages: (chatId: string) => Promise<void>;
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
 *
 * @example
 * ```typescript
 * const {
 *   currentChatId,
 *   pendingChatId,
 *   messages,
 *   createNewChat,
 *   loadChat,
 *   deleteChat,
 *   listChats,
 *   clearCurrentChat,
 *   activatePendingChat,
 *   saveUserMessage,
 *   saveAIResponse,
 * } = useChatManagement({
 *   repository: chatRepository,
 *   clientRef,
 * });
 * ```
 */
export function useChatManagement({
  repository,
  clientRef,
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

  const [messages, setMessages] = useState<Message[]>([]);

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

  /**
   * Loads messages from storage for a given chat ID.
   */
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

  /**
   * Reloads messages from storage and updates state.
   */
  const reloadMessages = useCallback(async (chatId: string) => {
    const loadedMessages = await loadChatMessages(chatId);
    setMessages(loadedMessages);
  }, [loadChatMessages]);

  /**
   * Creates a new chat.
   */
  const createNewChat = useCallback(async (): Promise<string> => {
    console.log('[ChatManagement] createNewChat called - currentChatId:', currentChatId, 'pendingChatId:', pendingChatId, 'messages.length:', messages.length);

    // If we already have a pending blank chat, don't create another one
    if (pendingChatId && messages.length === 0) {
      console.log('[ChatManagement] Pending chat is already blank, not creating new chat');
      return pendingChatId;
    }

    // If current chat is already blank (and no pending chat), don't create a new one
    if (currentChatId && !pendingChatId && messages.length === 0) {
      console.log('[ChatManagement] Current chat is already blank, not creating new chat');
      return currentChatId;
    }

    console.log('[ChatManagement] Creating new chat...');
    const chatId = await repository.createChat();

    // Set as pending - don't switch currentChatId until user sends a message
    setPendingChatId(chatId);
    setMessages([]); // Clear messages for the new blank chat

    // Set threadId to new chatId to ensure clean conversation state
    if (clientRef.current) {
      clientRef.current.setThreadId(chatId);
      console.log('[ChatManagement] Set threadId to new chatId:', chatId);
    }

    console.log('[ChatManagement] Created pending chat:', chatId, '(will activate on first message)');
    return chatId;
  }, [currentChatId, pendingChatId, messages, repository, clientRef]);

  /**
   * Loads an existing chat by ID.
   */
  const loadChat = useCallback(async (chatId: string): Promise<void> => {
    // Set as pending chat - don't activate until user sends a message
    // This prevents race condition if AI is still responding to current chat
    setPendingChatId(chatId);

    // Load messages from storage for display
    await reloadMessages(chatId);

    // Set threadId to chatId to ensure server recognizes this as a different conversation
    // This clears conversation state on the client and signals the server to clear history
    if (clientRef.current) {
      clientRef.current.setThreadId(chatId);
      console.log('[ChatManagement] Set threadId to chatId:', chatId);
    }

    console.log('[ChatManagement] Loaded pending chat:', chatId, '(will activate on first message)');
  }, [reloadMessages, clientRef]);

  /**
   * Deletes a chat by ID.
   */
  const deleteChat = useCallback(async (chatId: string): Promise<void> => {
    await repository.deleteChat(chatId);

    // Clear current chat if it's the one being deleted
    if (currentChatId === chatId) {
      setCurrentChatId(null);
      setMessages([]);
    }

    // Clear pending chat if it's the one being deleted
    if (pendingChatId === chatId) {
      setPendingChatId(null);
      setMessages([]);
    }

    console.log('[ChatManagement] Deleted chat:', chatId);
  }, [currentChatId, pendingChatId, repository]);

  /**
   * Lists all available chats.
   */
  const listChats = useCallback(async (): Promise<Array<Omit<Chat, 'messages'>>> => {
    return await repository.listChats();
  }, [repository]);

  /**
   * Clears the current chat messages.
   */
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
  }, [currentChatId, repository]);

  /**
   * Activates the pending chat (called when user sends first message).
   * Returns the activated chat ID, or null if no pending chat.
   */
  const activatePendingChat = useCallback((): string | null => {
    if (!pendingChatId) return null;

    console.log('[ChatManagement] Activating pending chat:', pendingChatId);

    // Load messages into client if they exist
    if (clientRef.current && messages.length > 0) {
      clientRef.current.loadMessages(transformMessagesToClientFormat(messages));
      console.log('[ChatManagement] Loaded', messages.length, 'existing messages into client');
    }

    setCurrentChatId(pendingChatId);
    setPendingChatId(null);

    return pendingChatId;
  }, [pendingChatId, messages, clientRef]);

  /**
   * Saves a user message to storage.
   */
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

      // Auto-generate title from text content
      if (!chat.title) {
        const text = getTextFromContent(content);
        if (text) {
          chat.title = generateChatTitle(text);
        }
      }

      await repository.saveChat(chat);
      console.log('[ChatManagement] Saved user message to storage');

      // Reload messages to show the new message
      await reloadMessages(chatId);
      return true;
    } catch (error) {
      console.error('[ChatManagement] Failed to save user message:', error);
      return false;
    }
  }, [repository, reloadMessages]);

  /**
   * Saves an AI response to storage and updates UI.
   */
  const saveAIResponse = useCallback(async (
    content: string,
    displayMode?: 'default' | 'error',
    citations?: Citation[]
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
      const message: {
        id: string;
        role: 'assistant';
        content: string;
        createdAt: Date;
        displayMode?: 'default' | 'error';
        citations?: Citation[];
      } = {
        id: generateMessageId(),
        role: 'assistant',
        content,
        createdAt: new Date(),
        displayMode,
      };

      // Add citations if provided
      if (citations && citations.length > 0) {
        message.citations = citations;
      }

      chat.messages.push(message);

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

      // Reload UI if user is viewing this chat
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
  }, [currentChatId, pendingChatId, createNewChat, repository, loadChatMessages, clientRef]);

  // The displayed chat ID is the pending chat (if any) or the current active chat
  const displayedChatId = pendingChatId || currentChatId;

  return {
    currentChatId,
    pendingChatId,
    messages,
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
    currentChatIdSnapshot,
    pendingChatIdSnapshot,
  };
}
