import { useState, useEffect, useRef, useCallback } from 'react';
import type { UseAIClient } from '../client';
import type { FeedbackValue, AGUIEvent, RunFinishedEvent } from '../types';
import type { ChatRepository } from '../providers/chatRepository/types';
import type { Message } from '../components/UseAIChatPanel';
import { EventType } from '../types';

export interface UseFeedbackOptions {
  /** Reference to the UseAIClient */
  clientRef: React.MutableRefObject<UseAIClient | null>;
  /** Chat repository for persisting feedback */
  repository: ChatRepository;
  /** Callback to get the currently displayed chat ID */
  getDisplayedChatId: () => string | null;
  /** Setter for messages state (for optimistic UI updates) */
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
}

export interface UseFeedbackReturn {
  /** Whether Langfuse feedback is enabled on the server */
  enabled: boolean;
  /** Gets the current run's traceId (captured from RUN_FINISHED) */
  getTraceId: () => string | null;
  /** Clears the current traceId (call after saving AI response) */
  clearTraceId: () => void;
  /** Submits feedback for a message (updates storage and sends to server) */
  submitFeedback: (messageId: string, traceId: string, feedback: FeedbackValue) => void;
}

/**
 * Hook for managing user feedback on AI messages.
 *
 * Responsibilities:
 * - Tracks whether Langfuse feedback is enabled on the server
 * - Captures traceId from RUN_FINISHED events
 * - Persists feedback to chat storage
 * - Sends feedback to server (Langfuse)
 *
 * @example
 * ```typescript
 * const { enabled, getTraceId, clearTraceId, submitFeedback } = useFeedback({
 *   clientRef,
 *   repository,
 *   getDisplayedChatId: () => displayedChatId,
 *   setMessages,
 * });
 * ```
 */
export function useFeedback({
  clientRef,
  repository,
  getDisplayedChatId,
  setMessages,
}: UseFeedbackOptions): UseFeedbackReturn {
  const [enabled, setEnabled] = useState(false);
  const enabledRef = useRef(false);
  const currentTraceIdRef = useRef<string | null>(null);

  // Keep enabledRef in sync with state
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  // Subscribe to Langfuse config changes from server
  useEffect(() => {
    const client = clientRef.current;
    if (!client) return;

    const unsubscribe = client.onLangfuseConfigChange((isEnabled) => {
      setEnabled(isEnabled);
    });

    return unsubscribe;
  }, [clientRef.current]);

  // Subscribe to RUN_FINISHED events to capture traceId
  useEffect(() => {
    const client = clientRef.current;
    if (!client) return;

    const unsubscribe = client.onEvent('feedback', (event: AGUIEvent) => {
      if (event.type === EventType.RUN_FINISHED) {
        const finishedEvent = event as RunFinishedEvent;
        currentTraceIdRef.current = finishedEvent.runId;
      }
    });

    return unsubscribe;
  }, [clientRef.current]);

  const getTraceId = useCallback(() => {
    return currentTraceIdRef.current;
  }, []);

  const clearTraceId = useCallback(() => {
    currentTraceIdRef.current = null;
  }, []);

  /**
   * Updates feedback in storage and local state.
   */
  const updateFeedbackInStorage = useCallback(async (
    messageId: string,
    feedback: FeedbackValue
  ): Promise<void> => {
    const displayedChatId = getDisplayedChatId();

    if (!displayedChatId) {
      console.warn('[useFeedback] No chat ID, cannot update feedback');
      return;
    }

    try {
      const chat = await repository.loadChat(displayedChatId);

      if (!chat) {
        console.error('[useFeedback] Chat not found:', displayedChatId);
        return;
      }

      // Find and update the message
      const message = chat.messages.find(msg => msg.id === messageId);
      if (message) {
        message.feedback = feedback;
        await repository.saveChat(chat);

        // Update local state immediately for responsive UI
        setMessages(prevMessages =>
          prevMessages.map(msg =>
            msg.id === messageId ? { ...msg, feedback } : msg
          )
        );
      } else {
        console.warn('[useFeedback] Message not found:', messageId);
      }
    } catch (error) {
      console.error('[useFeedback] Failed to update feedback:', error);
    }
  }, [repository, getDisplayedChatId, setMessages]);

  const submitFeedback = useCallback((
    messageId: string,
    traceId: string,
    feedback: FeedbackValue
  ) => {
    // Update storage and local state
    updateFeedbackInStorage(messageId, feedback);

    // Send to server if connected and Langfuse is enabled
    const client = clientRef.current;
    if (client && enabledRef.current) {
      client.submitFeedback(messageId, traceId, feedback);
    }
  }, [clientRef, updateFeedbackInStorage]);

  return {
    enabled,
    getTraceId,
    clearTraceId,
    submitFeedback,
  };
}
