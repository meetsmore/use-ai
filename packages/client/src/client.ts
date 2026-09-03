import { EventType } from '@meetsmore-oss/use-ai-core';
import type {
  ToolDefinition,
  Message,
  RunAgentInput,
  AGUIEvent,
  TextMessageStartEvent,
  TextMessageContentEvent,
  ToolCallStartEvent,
  ToolCallArgsEvent,
  ToolCallEndEvent,
  ToolCallResultEvent,
  UseAIClientMessage,
  ToolResultMessage,
  ToolApprovalResponseMessage,
  AgentInfo,
  MultimodalContent,
  UserMessageContent,
  FeedbackValue,
  UseAIForwardedProps,
  ReasoningMessageContentEvent,
  ReasoningEncryptedValueEvent,
  ReasoningPart,
} from './types';
import { SocketIOTransport } from './transport/SocketIOTransport';
import type { UseAITransport } from './transport/types';
import { v4 as uuidv4 } from 'uuid';

/**
 * Handler for AG-UI events from the server.
 */
export type AGUIEventHandler = (event: AGUIEvent) => void;

/**
 * Simplified message handler for text responses.
 */
export type MessageHandler = (content: string) => void;

/**
 * Tool call handler that receives the tool name, arguments, and a callback to send the result.
 */
export type ToolCallHandler = (
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>
) => void;

/**
 * Client for communicating with the UseAI server.
 * Uses the AG-UI protocol (https://docs.ag-ui.com/), so will be compatible with other AG-UI compliant servers.
 *
 * Handles:
 * - Connection management, via a {@link UseAITransport}
 * - Sending RunAgentInput messages to server
 * - Parsing AG-UI event streams from server
 * - Tool execution coordination
 *
 * You probably don't need to use this directly, instead use {@link UseAIProvider}.
 */
export class UseAIClient {
  private transport: UseAITransport;
  private transportUnsubscribes: Array<() => void> = [];
  private eventHandlers: Map<string, AGUIEventHandler> = new Map();

  // Session state
  private _threadId: string | null = null;
  private _tools: ToolDefinition[] = [];
  private _messages: Message[] = [];
  private _state: unknown = null;
  // Tracks the in-flight run so abortRun() can target it. Set by sendPrompt
  // and cleared at RUN_FINISHED / RUN_ERROR.
  private _currentRunId: string | null = null;

  // Agent selection
  private _availableAgents: AgentInfo[] = [];
  private _defaultAgent: string | null = null;
  private _selectedAgent: string | null = null;
  private agentsChangeHandlers: Set<(agents: AgentInfo[], defaultAgent: string | null) => void> = new Set();

  // Connection state handlers
  private connectionStateHandlers: Set<(connected: boolean) => void> = new Set();

  // Text message assembly
  private _currentMessageId: string | null = null;
  private _currentMessageContent: string = '';

  // Assistant message assembly (for tracking full conversation history)
  private _currentAssistantMessage: { id: string; role: 'assistant'; content: string } | null = null;
  private _currentAssistantToolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string }; encryptedValue?: string }> = [];
  // Tool results collected during a turn, pushed to _messages in correct order at RUN_FINISHED
  private _pendingToolResults: Message[] = [];

  // Tool call assembly
  private currentToolCalls: Map<string, {
    name: string;
    args: string;
  }> = new Map();

  // Reasoning/thinking assembly
  private _currentReasoningBlocks: ReasoningPart[] = [];
  private _currentReasoningBlockText: string = '';

  // Feedback tracking
  private _langfuseEnabled = false;
  private langfuseConfigHandlers: Set<(enabled: boolean) => void> = new Set();

  /**
   * Creates a new UseAI client instance.
   *
   * @param target - The URL of the UseAI server, which is reached over Socket.IO, or a
   *   {@link UseAITransport} to reach it over something else.
   * @example
   * ```typescript
   * new UseAIClient('wss://your-server.com');
   * new UseAIClient(new WebSocketTransport('wss://your-server.com/ws'));
   * ```
   */
  constructor(target: string | UseAITransport) {
    this.transport = typeof target === 'string' ? new SocketIOTransport(target) : target;
  }

  /**
   * Opens the transport's connection to the server.
   * Connection state changes are notified via onConnectionStateChange().
   * Reconnection is the transport's responsibility and is automatic for both bundled transports.
   */
  connect(): void {
    this.transportUnsubscribes.push(
      this.transport.on('connect', () => {
        console.log('[UseAI] Connected to server');
        this.connectionStateHandlers.forEach(handler => handler(true));
      }),

      this.transport.on('event', (data) => {
        const aguiEvent = data as AGUIEvent;
        try {
          console.log('[Client] Received event:', aguiEvent.type);
          this.handleEvent(aguiEvent);
        } catch (error) {
          console.error('[UseAI] Error handling event:', error);
        }
      }),

      this.transport.on('agents', (data) => {
        const { agents, defaultAgent } = data as { agents: AgentInfo[]; defaultAgent: string };
        console.log('[Client] Received available agents:', data);
        this._availableAgents = agents;
        this._defaultAgent = defaultAgent;
        this.agentsChangeHandlers.forEach(handler => handler(agents, defaultAgent));
      }),

      this.transport.on('config', (data) => {
        const { langfuseEnabled } = data as { langfuseEnabled?: boolean };
        console.log('[Client] Received server config:', data);
        this._langfuseEnabled = langfuseEnabled ?? false;
        this.langfuseConfigHandlers.forEach(handler => handler(this._langfuseEnabled));
      }),

      this.transport.on('disconnect', (reason) => {
        console.log('[UseAI] Disconnected:', reason);
        this.connectionStateHandlers.forEach(handler => handler(false));
      }),
    );

    this.transport.connect();
  }


  private handleEvent(event: AGUIEvent) {
    // Track assistant message lifecycle for conversation history
    if (event.type === EventType.RUN_STARTED) {
      // Start of a new assistant response - initialize message
      this._currentAssistantMessage = {
        id: uuidv4(),
        role: 'assistant' as const,
        content: '',
      };
      this._currentAssistantToolCalls = [];
      this._pendingToolResults = [];
      this._currentReasoningBlocks = [];
      this._currentReasoningBlockText = '';
      // Documented invariant (see finalizeRun): the persistence helper reads
      // _currentMessageContent until the next run starts. A tool-only step
      // never emits TEXT_MESSAGE_START (which is what otherwise resets this),
      // so clear it here to stop a prior run's text from leaking into an
      // aborted tool-call step's persisted output.
      this._currentMessageContent = '';
    }

    // Handle text message streaming
    if (event.type === EventType.TEXT_MESSAGE_START) {
      const e = event as TextMessageStartEvent;
      this._currentMessageId = e.messageId;
      this._currentMessageContent = '';
    } else if (event.type === EventType.TEXT_MESSAGE_CONTENT) {
      const e = event as TextMessageContentEvent;
      this._currentMessageContent += e.delta;
    } else if (event.type === EventType.TEXT_MESSAGE_END) {
      // Message complete - store content in assistant message
      if (this._currentAssistantMessage) {
        this._currentAssistantMessage.content = this._currentMessageContent;
      }
      this._currentMessageId = null;
    }

    // Handle tool call streaming
    else if (event.type === EventType.TOOL_CALL_START) {
      const e = event as ToolCallStartEvent;
      this.currentToolCalls.set(e.toolCallId, {
        name: e.toolCallName,
        args: '',
      });
    } else if (event.type === EventType.TOOL_CALL_ARGS) {
      const e = event as ToolCallArgsEvent;
      const toolCall = this.currentToolCalls.get(e.toolCallId);
      if (toolCall) {
        toolCall.args += e.delta;
      }
    } else if (event.type === EventType.TOOL_CALL_END) {
      // Tool call args complete - add to assistant message
      const e = event as ToolCallEndEvent;
      const toolCall = this.currentToolCalls.get(e.toolCallId);
      if (toolCall) {
        this._currentAssistantToolCalls.push({
          id: e.toolCallId,
          type: 'function',
          function: {
            name: toolCall.name,
            arguments: toolCall.args,
          },
        });
      }
    }

    // Handle reasoning events (AG-UI protocol)
    else if (event.type === EventType.REASONING_MESSAGE_START) {
      this._currentReasoningBlockText = '';
    } else if (event.type === EventType.REASONING_MESSAGE_CONTENT) {
      const e = event as ReasoningMessageContentEvent;
      this._currentReasoningBlockText += e.delta;
    } else if (event.type === EventType.REASONING_MESSAGE_END) {
      this._currentReasoningBlocks.push({
        text: this._currentReasoningBlockText,
      });
      this._currentReasoningBlockText = '';
    } else if (event.type === EventType.REASONING_ENCRYPTED_VALUE) {
      const e = event as ReasoningEncryptedValueEvent;
      if (e.subtype === 'message' && this._currentReasoningBlocks.length > 0) {
        // Attach encrypted value to the most recent reasoning block (Anthropic/OpenAI)
        const lastBlock = this._currentReasoningBlocks[this._currentReasoningBlocks.length - 1];
        lastBlock.encryptedValue = e.encryptedValue;
      } else if (e.subtype === 'tool-call' && e.entityId) {
        // Gemini: attach encrypted value (thoughtSignature) to the tool call.
        // entityId is the toolCallId for this subtype.
        const tc = this._currentAssistantToolCalls.find(tc => tc.id === e.entityId);
        if (tc) {
          tc.encryptedValue = e.encryptedValue;
        }
      }
    }

    // Handle server-side tool results (MCP tools, server tools).
    // The server emits TOOL_CALL_RESULT with the actual execution output so the
    // client can store it in conversation history instead of a placeholder.
    // Client-side tools already have their results tracked via sendToolResponse(),
    // so we skip those to avoid duplicate entries.
    else if (event.type === EventType.TOOL_CALL_RESULT) {
      const e = event as ToolCallResultEvent;
      const alreadyTracked = this._pendingToolResults.some(
        r => 'toolCallId' in r && r.toolCallId === e.toolCallId
      );
      if (!alreadyTracked) {
        this._pendingToolResults.push({
          id: e.messageId,
          role: 'tool',
          content: e.content,
          toolCallId: e.toolCallId,
        });
      }
    }

    // Handle step completion - flush per-step messages if tool calls occurred
    else if (event.type === EventType.STEP_FINISHED) {
      if (this._currentAssistantToolCalls.length > 0 && this._currentAssistantMessage) {
        // Create assistant message with text + toolCalls for this step
        // Attach reasoning parts collected during this step
        const reasoningParts = this._currentReasoningBlocks.length > 0 ? [...this._currentReasoningBlocks] : undefined;
        const assistantMsg: Message & { reasoningParts?: ReasoningPart[] } = {
          id: this._currentAssistantMessage.id || uuidv4(),
          role: 'assistant',
          content: this._currentAssistantMessage.content || '',
          toolCalls: [...this._currentAssistantToolCalls],
          ...(reasoningParts ? { reasoningParts } : {}),
        };
        this._messages.push(assistantMsg);

        // Push tool results for this step
        this._messages.push(...this._pendingToolResults);

        // Reset for next step
        this._currentAssistantMessage = { id: uuidv4(), role: 'assistant', content: '' };
        this._currentAssistantToolCalls = [];
        this._pendingToolResults = [];
        this._currentReasoningBlocks = [];
        // Clear so an abort before the next TEXT_MESSAGE_START doesn't duplicate this step's text.
        this._currentMessageContent = '';
      }
    }

    // Handle run completion - flush remaining assistant message
    else if (event.type === EventType.RUN_FINISHED) {
      this.finalizeRun({ aborted: false });
    }

    // Clear the in-flight run id once the run terminates (either way).
    // RUN_ERROR is also used for user-initiated aborts (ErrorCode.ABORTED).
    if (event.type === EventType.RUN_FINISHED || event.type === EventType.RUN_ERROR) {
      this._currentRunId = null;
    }

    // Notify all registered handlers
    this.eventHandlers.forEach((handler) => handler(event));
  }

  /**
   * Registers available tools and optional state with the server.
   * This updates the session state for future agent runs.
   *
   * @param tools - Array of tool definitions to register
   * @param state - Optional state object to provide to the AI.
   */
  registerTools(tools: ToolDefinition[], state?: unknown) {
    this._tools = tools;
    // Only update state if explicitly provided to avoid overwriting state set by updateState
    if (state !== undefined) {
      this._state = state;
    }
  }

  /**
   * Updates the state without re-registering tools.
   * Call this before sendPrompt to ensure the AI sees the latest UI state.
   *
   * @param state - The current state object to provide to the AI
   */
  updateState(state: unknown) {
    this._state = state;
  }

  /**
   * Sends a user prompt to the AI.
   *
   * @param prompt - The user's prompt/question (text part)
   * @param multimodalContent - Optional multimodal content (text, images, files)
   * @param forwardedProps - Optional props to forward to the server (e.g., telemetryMetadata, mcpHeaders).
   *                         Internally merged with other forwardedProps.
   */
  async sendPrompt(prompt: string, multimodalContent?: MultimodalContent[], forwardedProps?: UseAIForwardedProps) {
    // Build message content - use multimodal if provided, otherwise just the text
    let messageContent: UserMessageContent = prompt;

    if (multimodalContent && multimodalContent.length > 0) {
      // Each MultimodalContent variant is already in the wire shape the server reads
      // (see messageConversion.ts), so the parts go on the wire unchanged.
      messageContent = multimodalContent;
    }

    // Add user message to conversation
    const userMessage: Message = {
      id: uuidv4(),
      role: 'user',
      // @ag-ui/core declares Message.content as `string`; the wire also carries MultimodalContent[].
      content: messageContent as string,
    };
    this._messages.push(userMessage);

    // Create RunAgentInput
    const runId = uuidv4();
    this._currentRunId = runId;
    const runInput: RunAgentInput = {
      threadId: this.threadId, // Use getter to ensure non-null
      runId,
      messages: this._messages,
      tools: this._tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
        annotations: t.annotations,
      })),
      state: this._state,
      context: [],
      forwardedProps: {
        ...(this._selectedAgent ? { agent: this._selectedAgent } : {}),
        ...(forwardedProps || {}),
      },
    };

    this.send({
      type: 'run_agent',
      data: runInput,
    });
  }

  /**
   * Sends the result of a tool execution back to the server.
   *
   * @param toolCallId - The ID of the tool call being responded to
   * @param result - The result returned by the tool execution
   * @param state - Optional updated state to send back to the AI
   */
  sendToolResponse(toolCallId: string, result: unknown, state?: unknown) {
    // Update session state if provided
    if (state !== undefined) {
      this._state = state;
    }

    const toolResultMessage: ToolResultMessage = {
      type: 'tool_result',
      data: {
        messageId: uuidv4(),
        toolCallId,
        content: JSON.stringify(result),
        role: 'tool',
        // use-ai extension: include current tools and state for mid-run updates
        // (e.g., when navigation causes new components to mount)
        forwardedProps: {
          tools: this._tools,
          state: this._state,
        },
      },
    };

    // Collect tool result for deferred push at RUN_FINISHED (ensures correct
    // API ordering: assistant(toolCalls) → tool results → assistant(text))
    const toolResultMsg: Message = {
      id: toolResultMessage.data.messageId,
      role: 'tool',
      content: toolResultMessage.data.content,
      toolCallId,
    };
    this._pendingToolResults.push(toolResultMsg);

    this.send(toolResultMessage);
  }

  /**
   * Aborts the in-flight run, if any.
   * Sends an `abort_run` message to the server which cancels the AI stream
   * and rejects any pending tool/approval waits. The server then emits
   * `RUN_ERROR` with `ErrorCode.ABORTED`, which the client handles by
   * persisting the partial response.
   *
   * No-op when no run is in flight.
   */
  abortRun(): void {
    const runId = this._currentRunId;
    if (!runId) return;
    this.send({
      type: 'abort_run',
      data: { runId },
    });
  }

  /**
   * Flushes the final in-progress step into `_messages` when a run terminates.
   *
   * Only two terminations reach here. Truncation (maxOutputTokens / finish
   * reason 'length') and tool-execution errors never do — the server absorbs
   * them: truncation continues via a fallback step and ends as a normal
   * RUN_FINISHED, and tool errors come back as tool_results that keep the run
   * going. So the dispatch is binary:
   *  - `aborted: false` (RUN_FINISHED): every tool-call step was already flushed
   *    at STEP_FINISHED, so the in-progress step is always text-only.
   *  - `aborted: true` (RUN_ERROR / ABORTED): the run may have been cut
   *    mid-tool-call or mid-reasoning, so extra repair is needed.
   *
   * After this returns, `currentMessageContent` and `currentReasoningBlocks`
   * remain readable for the persistence helper. The next RUN_STARTED clears them.
   */
  finalizeRun(opts: { aborted: boolean }): void {
    if (opts.aborted) {
      this.finalizeAbortedRun();
    } else {
      this.finalizeCompletedRun();
    }
  }

  /**
   * Normal completion (RUN_FINISHED). The in-progress step is text-only —
   * tool-call steps were already flushed at STEP_FINISHED — so just push the
   * trailing assistant text with its reasoning.
   */
  private finalizeCompletedRun(): void {
    // Mid-stream-truncated reasoning never gets REASONING_MESSAGE_END, so clear
    // the partial buffer to keep it from leaking into the next run.
    this._currentReasoningBlockText = '';

    if (!this._currentAssistantMessage) return;

    if (this._currentMessageContent) {
      const stepReasoning = this._currentReasoningBlocks.length > 0
        ? [...this._currentReasoningBlocks]
        : undefined;
      this._messages.push({
        id: this._currentAssistantMessage.id || uuidv4(),
        role: 'assistant',
        content: this._currentMessageContent,
        ...(stepReasoning ? { reasoningParts: stepReasoning } : {}),
      });
    }

    this._currentAssistantMessage = null;
    this._currentAssistantToolCalls = [];
    this._pendingToolResults = [];
  }

  /**
   * User-initiated abort (RUN_ERROR / ABORTED).
   *
   * Drops the in-progress step's reasoning blocks. A block gets its encrypted
   * signature on REASONING_ENCRYPTED_VALUE, which arrives after
   * REASONING_MESSAGE_END — so a mid-stream abort can leave signature-less
   * blocks. Persisting those would corrupt the next turn. Reasoning from
   * already-completed prior steps lives on STEP_FINISHED-flushed assistant
   * messages and is untouched. Aborted-step messages therefore never carry
   * reasoningParts.
   */
  private finalizeAbortedRun(): void {
    this._currentReasoningBlocks = [];
    this._currentReasoningBlockText = '';

    if (!this._currentAssistantMessage) return;

    // Aborted mid-tool-call: emit a single assistant with partial text +
    // toolCalls, flush received tool_results, and synthesize `{ aborted: true }`
    // results for any tool_use blocks that never got a client response — else
    // the next sendPrompt produces an invalid Anthropic API payload.
    if (this._currentAssistantToolCalls.length > 0) {
      this._messages.push({
        id: this._currentAssistantMessage.id || uuidv4(),
        role: 'assistant',
        content: this._currentMessageContent || '',
        toolCalls: [...this._currentAssistantToolCalls],
      });

      this._messages.push(...this._pendingToolResults);

      const respondedIds = new Set(
        this._pendingToolResults
          .map(m => ('toolCallId' in m ? m.toolCallId : undefined))
          .filter((id): id is string => typeof id === 'string')
      );
      for (const tc of this._currentAssistantToolCalls) {
        if (!respondedIds.has(tc.id)) {
          this._messages.push({
            id: uuidv4(),
            role: 'tool',
            content: JSON.stringify({ aborted: true, reason: 'Cancelled by user before tool finished' }),
            toolCallId: tc.id,
          });
        }
      }

      // The partial text now lives on the tool-call assistant above; clear it
      // so the persistence helper falls back to the ABORTED string instead of
      // saving the text twice.
      this._currentMessageContent = '';
    } else if (this._currentMessageContent) {
      // Aborted mid-text (no tools in flight): push the partial text. Leave
      // `_currentMessageContent` populated so the persistence helper can read it.
      this._messages.push({
        id: this._currentAssistantMessage.id || uuidv4(),
        role: 'assistant',
        content: this._currentMessageContent,
      });
    }

    this._currentAssistantMessage = null;
    this._currentAssistantToolCalls = [];
    this._pendingToolResults = [];
  }

  /**
   * Sends a tool approval response back to the server.
   *
   * @param toolCallId - The ID of the tool call being approved/rejected
   * @param approved - Whether the tool execution is approved
   * @param reason - Optional reason for rejection (shown to AI)
   */
  sendToolApprovalResponse(toolCallId: string, approved: boolean, reason?: string) {
    const message: ToolApprovalResponseMessage = {
      type: 'tool_approval_response',
      data: {
        toolCallId,
        approved,
        reason,
      },
    };

    // When a tool is rejected, the server handles it internally and never sends
    // a tool_result event back to the client. Track a synthetic tool result so
    // the conversation history has the required tool_use → tool_result pairing.
    // (Approved tools get their result tracked via sendToolResponse after execution.)
    if (!approved) {
      this._pendingToolResults.push({
        id: uuidv4(),
        role: 'tool',
        content: JSON.stringify({ rejected: true, reason: reason || 'User rejected tool execution' }),
        toolCallId,
      });
    }

    this.send(message);
  }

  /**
   * Retrieves accumulated tool call data for a specific tool call ID.
   * Used to get the complete tool name and arguments after they've been streamed
   * across multiple TOOL_CALL_ARGS events.
   *
   * @param toolCallId - The ID of the tool call
   * @returns Object with tool name and accumulated arguments, or undefined if not found
   */
  getToolCallData(toolCallId: string): { name: string; args: string } | undefined {
    return this.currentToolCalls.get(toolCallId);
  }

  /**
   * Registers an AG-UI event handler for receiving server events.
   *
   * @param id - Unique identifier for this handler
   * @param handler - Callback function to handle incoming AG-UI events
   * @returns Cleanup function to unregister the handler
   */
  onEvent(id: string, handler: AGUIEventHandler) {
    this.eventHandlers.set(id, handler);
    return () => {
      this.eventHandlers.delete(id);
    };
  }

  /**
   * Helper method to listen for text message content.
   * Aggregates TEXT_MESSAGE_CONTENT events and calls handler with complete messages.
   *
   * @param handler - Callback function to handle complete text messages
   * @returns Cleanup function
   */
  onTextMessage(handler: MessageHandler): () => void {
    return this.onEvent('text-message-handler', (event) => {
      if (event.type === EventType.TEXT_MESSAGE_END && this._currentMessageContent) {
        handler(this._currentMessageContent);
      }
    });
  }

  /**
   * Helper method to listen for tool call requests.
   * Aggregates TOOL_CALL_* events and calls handler with complete tool calls.
   *
   * @param handler - Callback function to handle tool calls
   * @returns Cleanup function
   */
  onToolCall(handler: ToolCallHandler): () => void {
    return this.onEvent('tool-call-handler', (event) => {
      if (event.type === EventType.TOOL_CALL_END) {
        const e = event as ToolCallEndEvent;
        const toolCall = this.currentToolCalls.get(e.toolCallId);
        if (toolCall) {
          try {
            const args = JSON.parse(toolCall.args);
            handler(e.toolCallId, toolCall.name, args);
            this.currentToolCalls.delete(e.toolCallId);
          } catch (error) {
            console.error('Error parsing tool call args:', error);
          }
        }
      }
    });
  }

  /**
   * Gets the current accumulated message content (useful during streaming).
   */
  get currentMessageContent(): string {
    return this._currentMessageContent;
  }

  /**
   * Gets the runId of the in-flight run, or null when no run is active.
   */
  get currentRunId(): string | null {
    return this._currentRunId;
  }

  /**
   * Gets the current reasoning blocks collected during the current run.
   */
  get currentReasoningBlocks(): ReasoningPart[] {
    return this._currentReasoningBlocks;
  }

  /**
   * Gets the current thread ID for this session.
   * Generates a new one if not set.
   */
  get threadId(): string {
    if (!this._threadId) {
      this._threadId = uuidv4();
    }
    return this._threadId;
  }

  /**
   * Gets the current conversation messages.
   */
  get messages(): Message[] {
    return this._messages;
  }

  /**
   * Gets the current state.
   */
  get state(): unknown {
    return this._state;
  }

  /**
   * Gets the list of available agents from the server.
   */
  get availableAgents(): AgentInfo[] {
    return this._availableAgents;
  }

  /**
   * Gets the default agent ID from the server.
   */
  get defaultAgent(): string | null {
    return this._defaultAgent;
  }

  /**
   * Gets the currently selected agent ID.
   * Returns null if using server default.
   */
  get selectedAgent(): string | null {
    return this._selectedAgent;
  }

  /**
   * Gets the effective agent ID (selected or default).
   */
  get currentAgent(): string | null {
    return this._selectedAgent ?? this._defaultAgent;
  }

  /**
   * Sets the agent to use for requests.
   * Pass null to use the server default.
   *
   * @param agentId - The agent ID to use, or null for server default
   */
  setAgent(agentId: string | null) {
    this._selectedAgent = agentId;
    console.log('[Client] Agent set to:', agentId ?? 'server default');
  }

  /**
   * Subscribes to agent changes (when server sends available agents).
   *
   * @param handler - Callback function receiving agents list and default agent
   * @returns Cleanup function to unsubscribe
   */
  onAgentsChange(handler: (agents: AgentInfo[], defaultAgent: string | null) => void): () => void {
    this.agentsChangeHandlers.add(handler);
    // Immediately call with current values if available
    if (this._availableAgents.length > 0) {
      handler(this._availableAgents, this._defaultAgent);
    }
    return () => {
      this.agentsChangeHandlers.delete(handler);
    };
  }

  /**
   * Subscribes to connection state changes.
   * This is called on both initial connection and reconnection.
   *
   * @param handler - Callback function receiving connection state (true = connected, false = disconnected)
   * @returns Cleanup function to unsubscribe
   */
  onConnectionStateChange(handler: (connected: boolean) => void): () => void {
    this.connectionStateHandlers.add(handler);
    // Immediately call with current state
    handler(this.isConnected());
    return () => {
      this.connectionStateHandlers.delete(handler);
    };
  }

  /**
   * Sets the thread ID for this session.
   * When the thread ID changes, conversation state is cleared to prevent history bleeding.
   * Use this when switching between different chat conversations.
   *
   * @param threadId - The thread/chat ID to use (typically the chatId)
   */
  setThreadId(threadId: string) {
    if (this._threadId !== threadId) {
      console.log('[Client] ThreadId changed, clearing conversation state', {
        oldThreadId: this._threadId,
        newThreadId: threadId,
      });

      // Clear conversation state when switching threads
      this._messages = [];
      this._currentMessageContent = '';
      this._currentMessageId = null;
      this.currentToolCalls.clear();
      this._currentAssistantMessage = null;
      this._currentAssistantToolCalls = [];
    }
    this._threadId = threadId;
  }

  /**
   * Loads messages into the conversation history (for resuming from storage).
   * @param messages - Array of messages to load
   */
  loadMessages(messages: Message[]) {
    this._messages = messages;
  }

  /**
   * Clears the conversation history and resets the thread.
   */
  clearConversation() {
    this._messages = [];
    this._threadId = null;
    this._currentMessageContent = '';
    this._currentMessageId = null;
    this.currentToolCalls.clear();
    this._currentAssistantMessage = null;
    this._currentAssistantToolCalls = [];
    this._pendingToolResults = [];
  }

  send(message: UseAIClientMessage) {
    if (this.transport.connected) {
      this.transport.send(message);
    } else {
      console.error('[UseAI] Not connected to server');
    }
  }

  /**
   * Closes the connection to the server and unsubscribes from the transport.
   */
  disconnect() {
    this.transportUnsubscribes.forEach(unsubscribe => unsubscribe());
    this.transportUnsubscribes = [];
    this.transport.disconnect();
  }

  /**
   * Checks if the client is currently connected to the server.
   *
   * @returns true if connected, false otherwise
   */
  isConnected(): boolean {
    return this.transport.connected;
  }

  /**
   * Subscribes to Langfuse config changes.
   *
   * @param handler - Callback function receiving langfuse enabled status
   * @returns Cleanup function to unsubscribe
   */
  onLangfuseConfigChange(handler: (enabled: boolean) => void): () => void {
    this.langfuseConfigHandlers.add(handler);
    // Immediately call with current value
    handler(this._langfuseEnabled);
    return () => {
      this.langfuseConfigHandlers.delete(handler);
    };
  }

  /**
   * Submits feedback for an assistant message.
   * Sends feedback to the server, which forwards it to Langfuse.
   *
   * @param messageId - The client-side message ID
   * @param traceId - The Langfuse trace ID (runId from RUN_FINISHED)
   * @param feedback - 'upvote' for positive, 'downvote' for negative, null to remove
   */
  submitFeedback(messageId: string, traceId: string, feedback: FeedbackValue): void {
    if (!this.transport.connected) {
      console.warn('[UseAI] Cannot submit feedback: not connected');
      return;
    }

    if (!this._langfuseEnabled) {
      console.warn('[UseAI] Cannot submit feedback: Langfuse not enabled on server');
      return;
    }

    this.send({
      type: 'message_feedback',
      data: { messageId, traceId, feedback },
    });
  }
}
