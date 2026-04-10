import { useState, useCallback, useRef } from 'react';
import type {
  AGUIEvent,
  ToolCallStartEvent,
  ToolCallEndEvent,
  RunErrorEvent,
  RunFinishedEvent,
  TextMessageContentEvent,
  ToolCallStartExtensions,
  ToolApprovalRequestEvent,
} from '../types';
import { EventType, ErrorCode, TOOL_APPROVAL_REQUEST } from '../types';
import type { UseAIClient } from '../client';
import type { UseToolSystemReturn } from './useToolSystem';
import type { UseAIStrings } from '../theme';
import type { PersistedMessage } from '../providers/chatRepository/types';
import { extractTurnMessages } from '../utils/messageConversion';

export interface UseServerEventsOptions {
  /** Tool system for executing tools and looking up tool metadata */
  toolSystem: UseToolSystemReturn;
  /** Saves an AI response to chat storage */
  saveAIResponse: (content: string, displayMode?: 'default' | 'error', traceId?: string, turnMessages?: PersistedMessage[]) => Promise<void>;
  /** UI strings for error messages and tool execution fallbacks */
  strings: UseAIStrings;
}

export interface ExecutingToolDisplay {
  displayText: string;
}

export interface UseServerEventsReturn {
  /** Whether the AI is currently loading/processing a response */
  loading: boolean;
  /** Set the loading state (e.g., when sending a message) */
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  /** Current streaming text from the AI response */
  streamingText: string;
  /** Clear streaming text (e.g., when starting a new message) */
  clearStreamingText: () => void;
  /** Currently executing tool info for UI display, or null */
  executingTool: ExecutingToolDisplay | null;
  /** Ref tracking which chat the current streaming text belongs to */
  streamingChatIdRef: React.MutableRefObject<string | null>;
  /**
   * Handles a server event. Called from the provider's client subscription.
   * Takes the client instance so it can access client-internal state
   * (currentToolCalls, currentMessageContent).
   */
  handleServerEvent: (client: UseAIClient, event: AGUIEvent) => Promise<void>;
}

/**
 * Hook that owns all server event handling state and logic.
 *
 * Manages:
 * - Loading state (set on message send, cleared on RUN_FINISHED/RUN_ERROR)
 * - Streaming text accumulation (TEXT_MESSAGE_CONTENT/END events)
 * - Executing tool display (TOOL_CALL_START/END events)
 * - Tool execution dispatch (delegates to toolSystem)
 * - Error handling (RUN_ERROR events)
 *
 * The provider creates the client and subscribes `handleServerEvent` to it.
 * This hook doesn't manage the client lifecycle — only the event handling.
 */
export function useServerEvents({
  toolSystem,
  saveAIResponse,
  strings,
}: UseServerEventsOptions): UseServerEventsReturn {
  const [loading, setLoading] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const streamingChatIdRef = useRef<string | null>(null);

  // Track message count at run start to extract turn messages at run end
  const messageCountAtRunStartRef = useRef<number>(0);

  // Tracks whether prior steps in this run emitted text, so we can insert
  // a paragraph separator (\n\n) in streamingText between steps.
  const hasTextFromPriorStepRef = useRef<boolean>(false);

  // Executing tool state for UI display
  const [executingToolRaw, setExecutingTool] = useState<{
    toolCallId: string;
    title: string | null;
  } | null>(null);
  const executingToolFallbackRef = useRef<string | null>(null);

  const clearStreamingText = useCallback(() => {
    setStreamingText('');
  }, []);

  // Keep refs to avoid stale closures in the event handler
  // (the handler is captured once per client lifecycle, but these deps may change)
  const toolSystemRef = useRef(toolSystem);
  toolSystemRef.current = toolSystem;

  const saveAIResponseRef = useRef(saveAIResponse);
  saveAIResponseRef.current = saveAIResponse;

  const stringsRef = useRef(strings);
  stringsRef.current = strings;

  const handleServerEvent = useCallback(async (client: UseAIClient, event: AGUIEvent) => {
    const ts = toolSystemRef.current;
    const strs = stringsRef.current;

    if (event.type === EventType.RUN_STARTED) {
      // Snapshot message count so we can extract turn messages at RUN_FINISHED.
      // The user message was already pushed to client.messages by sendPrompt(),
      // so messages added after this point are from the AI turn.
      messageCountAtRunStartRef.current = client.messages.length;
      hasTextFromPriorStepRef.current = false;
    } else if (event.type === EventType.TEXT_MESSAGE_START) {
      // Add paragraph separator between steps so combined text reads naturally
      if (hasTextFromPriorStepRef.current) {
        setStreamingText(prev => prev + '\n\n');
      }
    } else if (event.type === EventType.TOOL_CALL_START) {
      const e = event as ToolCallStartEvent & Partial<ToolCallStartExtensions>;

      // Get title from event annotations, local tool definition, or null (fallback)
      const tool = ts.aggregatedToolsRef.current[e.toolCallName];
      const title = e.annotations?.title ?? tool?._options?.annotations?.title ?? null;

      if (!title) {
        const fallbacks = strs.toolExecution.fallbackMessages;
        executingToolFallbackRef.current = fallbacks[Math.floor(Math.random() * fallbacks.length)];
      }

      setExecutingTool({ toolCallId: e.toolCallId, title });
    } else if (event.type === EventType.TOOL_CALL_END) {
      const toolCallEnd = event as ToolCallEndEvent;
      const toolCallId = toolCallEnd.toolCallId;

      setExecutingTool(prev => prev?.toolCallId === toolCallId ? null : prev);

      const toolCallData = (client as unknown as { currentToolCalls: Map<string, { name: string; args: string }> }).currentToolCalls.get(toolCallId);
      if (!toolCallData) {
        console.error(`[ServerEvents] Tool call ${toolCallId} not found`);
        return;
      }

      const name = toolCallData.name;
      const input = JSON.parse(toolCallData.args);

      // Skip tools not in our registry (likely workflow tools)
      const tool = ts.aggregatedToolsRef.current[name];
      if (!tool) {
        console.log(`[ServerEvents] Tool "${name}" not found in useAI tools, skipping (likely a workflow tool)`);
        return;
      }

      // Defer execution if tool requires approval
      if (tool._options?.annotations?.destructiveHint === true) {
        console.log(`[ServerEvents] Tool "${name}" requires approval, deferring execution`);
        ts.storePendingToolCall(toolCallId, name, input, toolCallData);
        return;
      }

      await ts.executeToolCall(toolCallId, name, input);
    } else if ((event.type as string) === TOOL_APPROVAL_REQUEST) {
      const e = event as unknown as ToolApprovalRequestEvent;
      ts.handleApprovalRequest(e);
    } else if (event.type === EventType.TEXT_MESSAGE_CONTENT) {
      const contentEvent = event as TextMessageContentEvent;
      hasTextFromPriorStepRef.current = true;
      setStreamingText(prev => prev + contentEvent.delta);
    } else if (event.type === EventType.TEXT_MESSAGE_END) {
      // Don't clear streaming text here — wait for RUN_FINISHED so text
      // stays visible across multi-step runs (no flash between steps).
    } else if (event.type === EventType.RUN_FINISHED) {
      // Use the last step's text for the final saved message.
      // Intermediate steps' text is preserved in turnMessages (via extractTurnMessages).
      const content = client.currentMessageContent;
      if (content) {
        const finishedEvent = event as RunFinishedEvent;
        const traceId = finishedEvent.runId;

        const turnMessages = extractTurnMessages(client.messages, messageCountAtRunStartRef.current);

        saveAIResponseRef.current(content, undefined, traceId, turnMessages);
      }
      setStreamingText('');
      streamingChatIdRef.current = null;
      // Clear executingTool in case TOOL_CALL_END was never received
      // (e.g., stream truncated by token limit)
      setExecutingTool(null);
      setLoading(false);
    } else if (event.type === EventType.RUN_ERROR) {
      const errorEvent = event as RunErrorEvent;
      const errorCode = errorEvent.message as ErrorCode;
      console.error('[ServerEvents] Run error:', errorCode);

      const userMessage = strs.errors[errorCode] || errorEvent.message || strs.errors[ErrorCode.UNKNOWN_ERROR];

      saveAIResponseRef.current(userMessage, 'error');
      setStreamingText('');
      streamingChatIdRef.current = null;

      // Clear executingTool in case TOOL_CALL_END was never received
      setExecutingTool(null);
      setLoading(false);
    }
  }, []);

  // Compute display value for UI
  const executingTool = executingToolRaw ? {
    displayText: executingToolRaw.title ?? executingToolFallbackRef.current ?? strings.toolExecution.fallbackMessages[0],
  } : null;

  return {
    loading,
    setLoading,
    streamingText,
    clearStreamingText,
    executingTool,
    streamingChatIdRef,
    handleServerEvent,
  };
}
