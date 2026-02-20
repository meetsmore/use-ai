import { useCallback, useRef, useEffect } from 'react';
import type { FileAttachment } from '../fileUpload/types';
import type { UseAIForwardedProps } from '../types';
import type { CreateChatOptions, ChatMetadata } from '../providers/chatRepository/types';

/**
 * Options for programmatically sending a message via sendMessage().
 */
export interface SendMessageOptions {
  /** Start a new chat before sending. Default: false (continue existing chat) */
  newChat?: boolean;
  /** File attachments to include with the message */
  attachments?: File[];
  /** Open the chat panel after sending. Default: true */
  openChat?: boolean;
  /** Metadata to set on the new chat (only used when newChat: true) */
  metadata?: ChatMetadata;
  /**
   * Forwarded props for observability and configuration (e.g., telemetryMetadata, mcpHeaders).
   * This is merged with provider-level forwardedProps (message-level takes precedence).
   */
  forwardedProps?: UseAIForwardedProps;
}

export interface UseMessageQueueOptions {
  /** The function that actually sends a message (the provider's handleSendMessage) */
  sendFn: (message: string, attachments?: FileAttachment[], forwardedProps?: UseAIForwardedProps) => Promise<void>;
  /** Creates a new chat */
  createNewChat: (options?: CreateChatOptions) => Promise<string>;
  /** Callback to open/close the chat panel */
  setOpen?: (open: boolean) => void;
  /** Whether the client is connected */
  connected: boolean;
  /** Whether the AI is currently loading/processing */
  loading: boolean;
  /** Whether there's a pending tool approval blocking the queue */
  hasPendingApproval: boolean;
}

export interface UseMessageQueueReturn {
  /**
   * Programmatically send a message to the chat.
   * Messages are queued and processed one at a time.
   * Throws on failure (e.g., not connected, no sendFn).
   */
  sendMessage: (message: string, options?: SendMessageOptions) => Promise<void>;
}

/**
 * Hook for queuing and sending programmatic messages.
 *
 * Handles:
 * - Message queuing (one at a time)
 * - Waiting for loading + approval to complete between messages
 * - Creating new chats before sending
 * - Opening the chat panel after sending
 * - Converting File[] to FileAttachment[]
 */
export function useMessageQueue({
  sendFn,
  createNewChat,
  setOpen,
  connected,
  loading,
  hasPendingApproval,
}: UseMessageQueueOptions): UseMessageQueueReturn {
  const pendingMessagesRef = useRef<Array<{ message: string; options?: SendMessageOptions }>>([]);
  const isProcessingQueueRef = useRef(false);

  // Use refs for callbacks that may change between renders.
  // The queue processor runs across async boundaries (awaits), during which
  // React may re-render and update these functions with fresh closures.
  // Refs ensure we always call the latest version.
  const sendFnRef = useRef(sendFn);
  sendFnRef.current = sendFn;

  const createNewChatRef = useRef(createNewChat);
  createNewChatRef.current = createNewChat;

  const setOpenRef = useRef(setOpen);
  setOpenRef.current = setOpen;

  const loadingRef = useRef(loading);
  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  const hasPendingApprovalRef = useRef(hasPendingApproval);
  useEffect(() => {
    hasPendingApprovalRef.current = hasPendingApproval;
  }, [hasPendingApproval]);

  const processMessageQueue = useCallback(async () => {
    if (isProcessingQueueRef.current || pendingMessagesRef.current.length === 0) {
      return;
    }

    isProcessingQueueRef.current = true;

    while (pendingMessagesRef.current.length > 0) {
      const { message, options } = pendingMessagesRef.current.shift()!;
      const { newChat = false, attachments = [], openChat = true, metadata, forwardedProps } = options ?? {};

      if (newChat) {
        await createNewChatRef.current({ metadata });
      }

      // Convert File[] to FileAttachment[]
      const fileAttachments: FileAttachment[] = await Promise.all(
        attachments.map(async (file) => {
          let preview: string | undefined;
          if (file.type.startsWith('image/')) {
            preview = await new Promise<string | undefined>((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : undefined);
              reader.onerror = () => resolve(undefined);
              reader.readAsDataURL(file);
            });
          }
          return {
            id: crypto.randomUUID(),
            file,
            preview,
          };
        })
      );

      await sendFnRef.current(message, fileAttachments.length > 0 ? fileAttachments : undefined, forwardedProps);

      if (openChat && setOpenRef.current) {
        setOpenRef.current(true);
      }

      // Wait for loading and pending approval to complete before processing next message
      await new Promise<void>((resolve) => {
        const checkReady = () => {
          setTimeout(() => {
            if (!loadingRef.current && !hasPendingApprovalRef.current) {
              resolve();
            } else {
              checkReady();
            }
          }, 100);
        };
        checkReady();
      });
    }

    isProcessingQueueRef.current = false;
  }, []);

  const sendMessage = useCallback(async (message: string, options?: SendMessageOptions): Promise<void> => {
    if (!connected) {
      throw new Error('Not connected to UseAI server');
    }

    pendingMessagesRef.current.push({ message, options });
    await processMessageQueue();
  }, [connected, processMessageQueue]);

  return { sendMessage };
}
