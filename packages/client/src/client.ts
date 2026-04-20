import { io, Socket } from 'socket.io-client';
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
  FeedbackValue,
  UseAIForwardedProps,
  ReasoningMessageContentEvent,
  ReasoningEncryptedValueEvent,
  ReasoningPart,
} from './types';
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
 * Socket.IO client for communicating with the UseAI server.
 * Uses the AG-UI protocol (https://docs.ag-ui.com/), so will be compatible with other AG-UI compliant servers.
 *
 * Handles:
 * - Connection management and automatic reconnection
 * - Sending RunAgentInput messages to server
 * - Parsing AG-UI event streams from server
 * - Tool execution coordination
 *
 * You probably don't need to use this directly, instead use {@link UseAIProvider}.
 */
export class UseAIClient {
  private socket: Socket | null = null;
  private eventHandlers: Map<string, AGUIEventHandler> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;

  // Session state
  private _threadId: string | null = null;
  private _tools: ToolDefinition[] = [];
  private _messages: Message[] = [];
  private _state: unknown = null;

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
   * @param serverUrl - The WebSocket URL of the UseAI server
   */
  constructor(private serverUrl: string) {}

  /**
   * Establishes a Socket.IO connection to the server.
   * Connection state changes are notified via onConnectionStateChange().
   * Socket.IO handles reconnection automatically.
   */
  connect(): void {
    this.socket = io(this.serverUrl, {
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionAttempts: this.maxReconnectAttempts,
      reconnectionDelay: this.reconnectDelay,
      withCredentials: true,
    });

    this.socket.on('connect', () => {
      console.log('[UseAI] Connected to server');
      console.log('[UseAI] Transport:', this.socket?.io?.engine?.transport?.name);
      this.reconnectAttempts = 0;

      // Listen for transport upgrades (only if engine is available)
      const engine = this.socket?.io?.engine;
      if (engine) {
        engine.on('upgrade', (transport: { name: string }) => {
          console.log('[UseAI] Upgraded to transport:', transport.name);
        });

        engine.on('upgradeError', (err: { message: string }) => {
          console.warn('[UseAI] Upgrade error:', err.message);
        });
      }

      // Notify connection state handlers
      this.connectionStateHandlers.forEach(handler => handler(true));
    });

    this.socket.on('event', (aguiEvent: AGUIEvent) => {
      try {
        console.log('[Client] Received event:', aguiEvent.type);
        this.handleEvent(aguiEvent);
      } catch (error) {
        console.error('[UseAI] Error handling event:', error);
      }
    });

    // Listen for available agents from server
    this.socket.on('agents', (data: { agents: AgentInfo[]; defaultAgent: string }) => {
      console.log('[Client] Received available agents:', data);
      this._availableAgents = data.agents;
      this._defaultAgent = data.defaultAgent;
      // Notify listeners
      this.agentsChangeHandlers.forEach(handler => handler(data.agents, data.defaultAgent));
    });

    // Listen for server config (including Langfuse enabled status)
    this.socket.on('config', (data: { langfuseEnabled?: boolean }) => {
      console.log('[Client] Received server config:', data);
      this._langfuseEnabled = data.langfuseEnabled ?? false;
      // Notify listeners
      this.langfuseConfigHandlers.forEach(handler => handler(this._langfuseEnabled));
    });

    this.socket.on('connect_error', (error) => {
      // Use warn instead of error to avoid triggering Next.js error overlay
      console.warn('[UseAI] Connection error:', error.message);
    });

    this.socket.on('disconnect', (reason) => {
      console.log('[UseAI] Disconnected:', reason);
      // Notify connection state handlers
      this.connectionStateHandlers.forEach(handler => handler(false));
    });
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
      }
    }

    // Handle run completion - flush remaining assistant message
    else if (event.type === EventType.RUN_FINISHED) {
      if (this._currentAssistantMessage) {
        const reasoningParts = this._currentReasoningBlocks.length > 0 ? [...this._currentReasoningBlocks] : undefined;

        if (this._currentAssistantToolCalls.length > 0) {
          // Tool calls not yet flushed by STEP_FINISHED (backward compat:
          // server didn't emit step events, or single-step with tool calls)
          const toolCallMessage: Message & { reasoningParts?: ReasoningPart[] } = {
            id: uuidv4(),
            role: 'assistant',
            content: '',
            toolCalls: this._currentAssistantToolCalls,
            ...(reasoningParts ? { reasoningParts } : {}),
          };
          this._messages.push(toolCallMessage);
          this._messages.push(...this._pendingToolResults);

          const textMessage: Message = {
            id: this._currentAssistantMessage.id!,
            role: 'assistant',
            content: this._currentAssistantMessage.content || '',
          };
          this._messages.push(textMessage);
        } else {
          // No remaining tool calls - just the final text response
          const assistantMessage: Message & { reasoningParts?: ReasoningPart[] } = {
            id: this._currentAssistantMessage.id!,
            role: 'assistant',
            content: this._currentAssistantMessage.content || '',
            ...(reasoningParts ? { reasoningParts } : {}),
          };
          this._messages.push(assistantMessage);
        }

        // Reset for next message
        // Note: _currentReasoningBlocks is NOT cleared here — external event handlers
        // (useServerEvents) read currentReasoningBlocks at RUN_FINISHED to persist
        // reasoningParts to localStorage. Clearing happens at the next RUN_STARTED.
        this._currentAssistantMessage = null;
        this._currentAssistantToolCalls = [];
        this._pendingToolResults = [];
      }
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
    // AG-UI Message type expects content to be string | ContentPart[]
    // For multimodal content, we pass the array; for text-only, we pass the string
    type MessageContent = string | Array<{ type: string; [key: string]: unknown }>;
    let messageContent: MessageContent = prompt;

    if (multimodalContent && multimodalContent.length > 0) {
      // Convert our MultimodalContent to AG-UI ContentPart format
      messageContent = multimodalContent.map(part => {
        if (part.type === 'text') {
          return { type: 'text', text: part.text };
        } else if (part.type === 'image') {
          return { type: 'image', url: part.url };
        } else if (part.type === 'file') {
          return {
            type: 'file',
            url: part.url,
            mimeType: part.mimeType,
          };
        } else {
          // transformed_file - pass through as-is, server will convert to text
          return {
            type: 'transformed_file',
            text: part.text,
            originalFile: part.originalFile,
          };
        }
      });
    }

    // Add user message to conversation
    const userMessage: Message = {
      id: uuidv4(),
      role: 'user',
      content: messageContent as string, // Type cast needed for Message type compatibility
    };
    this._messages.push(userMessage);

    // Create RunAgentInput
    const runInput: RunAgentInput = {
      threadId: this.threadId, // Use getter to ensure non-null
      runId: uuidv4(),
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
    if (this.socket && this.socket.connected) {
      this.socket.emit('message', message);
    } else {
      console.error('Socket.IO is not connected');
    }
  }

  /**
   * Closes the Socket.IO connection to the server.
   */
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  /**
   * Checks if the client is currently connected to the server.
   *
   * @returns true if connected, false otherwise
   */
  isConnected(): boolean {
    return this.socket !== null && this.socket.connected;
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
    if (!this.socket?.connected) {
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
