import { useState, useCallback, useRef } from 'react';
import type {
  AGUIEvent,
  ToolCallStartEvent,
  ToolCallEndEvent,
  ToolCallArgsEvent,
  RunErrorEvent,
  RunFinishedEvent,
  TextMessageContentEvent,
  ToolCallStartExtensions,
  ToolApprovalRequestEvent,
  ReasoningMessageContentEvent,
  ReasoningPart,
} from '../types';
import { EventType, ErrorCode, TOOL_APPROVAL_REQUEST } from '../types';
import type { UseAIClient } from '../client';
import { generateMessageId } from '../providers/chatRepository/types';
import type { UseToolSystemReturn } from './useToolSystem';
import type { UseAIStrings } from '../theme';
import type { PersistedMessage, MessageDisplayMode } from '../providers/chatRepository/types';
import { extractTurnMessages } from '../utils/messageConversion';

export interface UseServerEventsOptions {
  /** Tool system for executing tools and looking up tool metadata */
  toolSystem: UseToolSystemReturn;
  /** Saves an AI response to chat storage */
  saveAIResponse: (
    content: string,
    displayMode?: MessageDisplayMode,
    traceId?: string,
    turnMessages?: PersistedMessage[],
    reasoningParts?: ReasoningPart[],
    messageId?: string,
  ) => Promise<void>;
  /** UI strings for error messages and tool execution fallbacks */
  strings: UseAIStrings;
}

/**
 * One piece of the answer currently being produced, in the order the model
 * emitted it. A run that thinks, calls a tool, thinks again and answers keeps
 * those boundaries here, so the UI can show it as it happened. Flattening the
 * parts into what one bubble shows is the UI's job (see `utils/streamingParts`).
 */
export type ChatStreamingPart =
  | { kind: 'reasoning'; text: string }
  | { kind: 'text'; text: string }
  /** Args arrive as a JSON string, incomplete until the call is fully received. */
  | { kind: 'tool_call'; toolCallId: string; name: string; args: string };

export interface ExecutingToolDisplay {
  /** @example "toolu_01abc123" */
  toolCallId: string;
  /** Registered tool name, e.g. "searchDocs". */
  name: string;
  /** The tool's `title` annotation, or a generic fallback when it has none. */
  displayText: string;
}

export interface UseServerEventsReturn {
  /** Whether the AI is currently loading/processing a response */
  loading: boolean;
  /** Set the loading state (e.g., when sending a message) */
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  /**
   * Id the streaming answer will be persisted under, allocated at RUN_STARTED
   * and cleared when the run ends. The chat panel renders the streaming answer
   * as a provisional message with this id, so the persisted answer replaces it
   * under the same React key.
   * @example "msg_1723972800000_k3j9x2a"
   */
  streamingMessageId: string | null;
  /** Drop the in-flight answer (e.g., when starting a new message) */
  clearStreamingParts: () => void;
  /** Currently executing tool info for UI display, or null */
  executingTool: ExecutingToolDisplay | null;
  /** Ref tracking which chat the in-flight answer belongs to */
  streamingChatIdRef: React.MutableRefObject<string | null>;
  /** The in-flight answer split into ordered parts; empty between runs. */
  streamingParts: ChatStreamingPart[];
  /**
   * Handles a server event. Called from the provider's client subscription.
   * Takes the client instance so it can access client-internal state
   * (currentToolCalls, currentMessageContent).
   */
  handleServerEvent: (client: UseAIClient, event: AGUIEvent) => Promise<void>;
  /**
   * Handles a connection loss. When a disconnect occurs mid-run the server
   * session is destroyed and the run cannot resume, so we surface an error
   * message and clear in-flight UI state. No-op when no run is active.
   */
  handleDisconnect: () => void;
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
  const [streamingParts, setStreamingParts] = useState<ChatStreamingPart[]>([]);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  // Mirror of streamingMessageId for the stable event handler.
  const streamingMessageIdRef = useRef<string | null>(null);
  const streamingChatIdRef = useRef<string | null>(null);

  // Mirror of `loading` for use from stable callbacks (handleDisconnect) where
  // the value would otherwise be captured at hook construction time.
  const loadingRef = useRef(loading);
  loadingRef.current = loading;

  // Track message count at run start to extract turn messages at run end
  const messageCountAtRunStartRef = useRef<number>(0);
  // Captured at RUN_STARTED so RUN_ERROR (which carries no runId in AG-UI) can
  // still link saved partial responses back to the trace.
  const runIdAtRunStartRef = useRef<string | undefined>(undefined);

  // Executing tool state for UI display
  const [executingToolRaw, setExecutingTool] = useState<{
    toolCallId: string;
    name: string;
    title: string | null;
  } | null>(null);
  const executingToolFallbackRef = useRef<string | null>(null);

  // Set on REASONING_MESSAGE_END so the next reasoning delta opens a new part.
  // The server normally opens every block with REASONING_MESSAGE_START, but a
  // provider that streams deltas without a start chunk gets only one START per
  // step, and those deltas would otherwise land in the block that already
  // ended. The persisted side splits on END too (client.ts pushes one block per
  // END), so both sides cut the reasoning at the same boundary.
  const reasoningPartEndedRef = useRef(false);

  const clearStreamingParts = useCallback(() => {
    setStreamingParts([]);
  }, []);

  /** Appends `delta` to the trailing part of `kind`, starting one if needed. */
  const appendToPart = useCallback((kind: 'reasoning' | 'text', delta: string) => {
    setStreamingParts(prev => {
      const last = prev[prev.length - 1];
      if (last?.kind === kind) {
        return [...prev.slice(0, -1), { ...last, text: last.text + delta }];
      }
      return [...prev, { kind, text: delta }];
    });
  }, []);

  // Keep refs to avoid stale closures in the event handler
  // (the handler is captured once per client lifecycle, but these deps may change)
  const toolSystemRef = useRef(toolSystem);
  toolSystemRef.current = toolSystem;

  const saveAIResponseRef = useRef(saveAIResponse);
  saveAIResponseRef.current = saveAIResponse;

  const stringsRef = useRef(strings);
  stringsRef.current = strings;

  // Shared finalize-and-save path for both RUN_FINISHED and the user-initiated
  // ABORTED run-error. Reads the post-finalizeRun client state — currentMessageContent
  // for the final step's text (empty when an aborted tool-call step consumed it),
  // currentReasoningBlocks for the final step's reasoning (empty on abort).
  const persistFinalResponse = useCallback(async (client: UseAIClient, opts: { aborted: boolean; traceId?: string }) => {
    const content = client.currentMessageContent;
    const reasoningParts = client.currentReasoningBlocks.length > 0
      ? [...client.currentReasoningBlocks]
      : undefined;
    const turnMessages = extractTurnMessages(client.messages, messageCountAtRunStartRef.current);

    if (opts.aborted) {
      // Abort keeps the partial response (and context) intact and adds a
      // separate `info` bubble noting the interruption. The info bubble is
      // display-only: transformMessagesToClientFormat drops `info` messages, so
      // it never re-enters the context on reload.
      const notice = stringsRef.current.notices.aborted;
      if (content) {
        // Streamed text exists: persist it (with turnMessages for context),
        // then the info bubble below it. These must run sequentially: each call
        // does a load-modify-save of the whole chat, so firing both concurrently
        // races and the second save clobbers the first — dropping the turn's
        // tool context (only surfaces after reload, since in-memory state uses a
        // functional setMessages update that keeps both).
        await saveAIResponseRef.current(content, undefined, opts.traceId, turnMessages, reasoningParts, streamingMessageIdRef.current ?? undefined);
        await saveAIResponseRef.current(notice, 'info');
      } else {
        // No trailing text: skip the empty placeholder bubble. Attach
        // turnMessages to the info bubble so synthetic tool_results still
        // persist for the next turn's context.
        await saveAIResponseRef.current(notice, 'info', opts.traceId, turnMessages);
      }
      return;
    }

    // RUN_FINISHED: only persist when the AI produced a final text response.
    if (content) {
      await saveAIResponseRef.current(content, undefined, opts.traceId, turnMessages, reasoningParts, streamingMessageIdRef.current ?? undefined);
    }
  }, []);

  const resetRunUiState = useCallback(() => {
    setStreamingParts([]);
    setStreamingMessageId(null);
    streamingMessageIdRef.current = null;
    streamingChatIdRef.current = null;
    // Clear executingTool in case TOOL_CALL_END was never received
    // (e.g., stream truncated by token limit, or aborted mid-tool).
    setExecutingTool(null);
    setLoading(false);
  }, []);

  const handleServerEvent = useCallback(async (client: UseAIClient, event: AGUIEvent) => {
    const ts = toolSystemRef.current;
    const strs = stringsRef.current;

    if (event.type === EventType.RUN_STARTED) {
      // Snapshot message count so we can extract turn messages at RUN_FINISHED.
      // The user message was already pushed to client.messages by sendPrompt(),
      // so messages added after this point are from the AI turn.
      messageCountAtRunStartRef.current = client.messages.length;
      runIdAtRunStartRef.current = client.currentRunId ?? undefined;
      reasoningPartEndedRef.current = false;
      setStreamingParts([]);
      const messageId = generateMessageId();
      streamingMessageIdRef.current = messageId;
      setStreamingMessageId(messageId);
    } else if (event.type === EventType.REASONING_MESSAGE_START) {
      reasoningPartEndedRef.current = false;
      setStreamingParts(prev => [...prev, { kind: 'reasoning', text: '' }]);
    } else if (event.type === EventType.REASONING_MESSAGE_CONTENT) {
      const reasoningEvent = event as ReasoningMessageContentEvent;
      if (reasoningPartEndedRef.current) {
        reasoningPartEndedRef.current = false;
        setStreamingParts(prev => [...prev, { kind: 'reasoning', text: reasoningEvent.delta }]);
      } else {
        appendToPart('reasoning', reasoningEvent.delta);
      }
    } else if (event.type === EventType.TEXT_MESSAGE_START) {
      setStreamingParts(prev => [...prev, { kind: 'text', text: '' }]);
    } else if (event.type === EventType.TOOL_CALL_ARGS) {
      const argsEvent = event as ToolCallArgsEvent;
      setStreamingParts(prev => prev.map(part =>
        part.kind === 'tool_call' && part.toolCallId === argsEvent.toolCallId
          ? { ...part, args: part.args + argsEvent.delta }
          : part
      ));
    } else if (event.type === EventType.TOOL_CALL_START) {
      const e = event as ToolCallStartEvent & Partial<ToolCallStartExtensions>;

      // Get title from event annotations, local tool definition, or null (fallback)
      const tool = ts.aggregatedToolsRef.current[e.toolCallName];
      const title = e.annotations?.title ?? tool?._options?.annotations?.title ?? null;

      if (!title) {
        const fallbacks = strs.toolExecution.fallbackMessages;
        executingToolFallbackRef.current = fallbacks[Math.floor(Math.random() * fallbacks.length)];
      }

      setExecutingTool({ toolCallId: e.toolCallId, name: e.toolCallName, title });
      setStreamingParts(prev => [
        ...prev,
        { kind: 'tool_call', toolCallId: e.toolCallId, name: e.toolCallName, args: '' },
      ]);
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
      appendToPart('text', contentEvent.delta);
    } else if (event.type === EventType.REASONING_MESSAGE_END) {
      reasoningPartEndedRef.current = true;
    } else if (event.type === EventType.TEXT_MESSAGE_END) {
      // Don't clear streaming text here — wait for RUN_FINISHED so text
      // stays visible across multi-step runs (no flash between steps).
    } else if (event.type === EventType.RUN_FINISHED) {
      // client.ts handleEvent already called finalizeRun({ aborted: false })
      // for RUN_FINISHED; this branch only persists the resulting state.
      const finishedEvent = event as RunFinishedEvent;
      await persistFinalResponse(client, { aborted: false, traceId: finishedEvent.runId });
      resetRunUiState();
    } else if (event.type === EventType.RUN_ERROR) {
      const errorEvent = event as RunErrorEvent;
      const errorCode = errorEvent.message as ErrorCode;

      if (errorCode === ErrorCode.ABORTED) {
        // User stopped generation. Flush the aborted step into _messages
        // (synthesizing tool_results for unanswered tool_use blocks, dropping
        // signature-incomplete reasoning), then persist via the shared path.
        client.finalizeRun({ aborted: true });
        await persistFinalResponse(client, { aborted: true, traceId: runIdAtRunStartRef.current });
      } else {
        console.error('[ServerEvents] Run error:', errorCode);
        const userMessage = strs.errors[errorCode] || errorEvent.message || strs.errors[ErrorCode.UNKNOWN_ERROR];
        saveAIResponseRef.current(userMessage, 'error');
      }

      resetRunUiState();
    }
  }, []);

  const handleDisconnect = useCallback(() => {
    // Only surface an error / reset state when a run is in-flight. An idle
    // disconnect (no loading) doesn't need a phantom error message in the chat.
    if (!loadingRef.current) return;

    const strs = stringsRef.current;
    const message = strs.errors[ErrorCode.CONNECTION_LOST] || strs.errors[ErrorCode.UNKNOWN_ERROR];

    saveAIResponseRef.current(message, 'error');
    resetRunUiState();
  }, [resetRunUiState]);

  // Compute display value for UI
  const executingTool: ExecutingToolDisplay | null = executingToolRaw ? {
    toolCallId: executingToolRaw.toolCallId,
    name: executingToolRaw.name,
    displayText: executingToolRaw.title ?? executingToolFallbackRef.current ?? strings.toolExecution.fallbackMessages[0],
  } : null;

  return {
    loading,
    setLoading,
    streamingMessageId,
    clearStreamingParts,
    executingTool,
    streamingChatIdRef,
    streamingParts,
    handleServerEvent,
    handleDisconnect,
  };
}
