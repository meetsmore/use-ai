import type { Socket } from 'socket.io';
import type { ModelMessage } from 'ai';
import type { ToolDefinition, AGUIEvent } from '../types';

/**
 * Context for a single client session.
 * Contains all state needed for multi-turn conversations and tool coordination.
 */
export interface ClientSession {
  /** Unique identifier for this client connection */
  clientId: string;
  /** IP address of the client (used for rate limiting) */
  ipAddress: string;
  /** Socket.IO socket for bidirectional communication with client */
  socket: Socket;
  /** Unique identifier for the conversation thread */
  threadId: string;
  /** ID of the currently executing run (if any) */
  currentRunId?: string;
  /** Tools available to the AI agent for this session */
  tools: ToolDefinition[];
  /** Current application state (AG-UI format) */
  state: unknown;
  /** Full conversation history in AI SDK ModelMessage format (for AI API calls) */
  conversationHistory: ModelMessage[];
  /** Map of pending tool calls awaiting results from the client. Key: toolCallId, Value: resolver function */
  pendingToolCalls: Map<string, (content: string) => void>;
  /** MCP headers configuration for the current request (temporary, cleared after request) */
  currentMcpHeaders?: import('@meetsmore/use-ai-core').McpHeadersMap;
  /** AbortController for cancelling the current run */
  abortController?: AbortController;
  /** Cached MCP tools for this session, keyed by endpoint URL */
  mcpToolsCache?: Map<string, ToolDefinition[]>;
  /** Hash of auth headers used for cache key */
  mcpHeadersHash?: string;
  /** Timestamp when MCP tools cache was populated (for TTL-based invalidation) */
  mcpToolsCacheTimestamp?: number;
}

/**
 * Input for running an agent.
 * Provides all context needed to execute a run.
 */
export interface AgentInput {
  /** The client session context */
  session: ClientSession;
  /** The unique identifier for this run */
  runId: string;
  /** Conversation history in AI SDK ModelMessage format */
  messages: ModelMessage[];
  /** Available tools that the agent can call */
  tools: ToolDefinition[];
  /** Current application state (if any) */
  state: unknown;
  /** Optional system prompt to guide the agent */
  systemPrompt?: string;
  /** The original RunAgentInput from AG-UI protocol (for emitting RUN_STARTED event) */
  originalInput: import('../types').RunAgentInput;
}

/**
 * Interface for emitting AG-UI protocol events.
 * All agents must use this to communicate results to clients.
 */
export interface EventEmitter {
  /** Emit an AG-UI event to the client */
  emit<T extends AGUIEvent = AGUIEvent>(event: T): void;
}

/**
 * Result from an agent execution.
 * Indicates whether the run completed successfully and any final state.
 */
export interface AgentResult {
  /** Whether the run completed successfully */
  success: boolean;
  /** Error message if the run failed */
  error?: string;
  /** Final conversation history after the run */
  conversationHistory: ModelMessage[];
}

/**
 * Abstract interface for AI agents.
 *
 * Agents are pluggable backends that execute AI logic and emit AG-UI events.
 * Examples: AISDKAgent (via AI SDK with various providers like Anthropic, OpenAI, etc.)
 *
 * All agents must:
 * - Accept AgentInput with messages, tools, and state
 * - Emit AG-UI protocol events (TEXT_MESSAGE_*, TOOL_CALL_*, RUN_*, etc.)
 * - Handle tool call coordination (emit TOOL_CALL_START, wait for result, continue)
 * - Return AgentResult indicating success/failure
 *
 * @example
 * ```typescript
 * class MyCustomAgent implements Agent {
 *   async run(input: AgentInput, events: EventEmitter): Promise<AgentResult> {
 *     // 1. Emit RUN_STARTED
 *     events.emit({ type: EventType.RUN_STARTED, ... });
 *
 *     // 2. Process with your backend (API call, etc.)
 *     const result = await myBackend.process(input);
 *
 *     // 3. Emit TEXT_MESSAGE_* events for responses
 *     events.emit({ type: EventType.TEXT_MESSAGE_START, ... });
 *
 *     // 4. For tool calls, emit TOOL_CALL_START and wait for results
 *     events.emit({ type: EventType.TOOL_CALL_START, ... });
 *     const toolResult = await input.session.waitForToolResult(toolCallId);
 *
 *     // 5. Emit RUN_FINISHED
 *     events.emit({ type: EventType.RUN_FINISHED, ... });
 *
 *     return { success: true, conversationHistory: [...] };
 *   }
 * }
 * ```
 */
export interface Agent {
  /**
   * Executes an agent run with the given input.
   * Must emit AG-UI events and coordinate tool execution.
   *
   * @param input - The run context (session, messages, tools, state)
   * @param events - Event emitter for sending AG-UI events to client
   * @returns Promise resolving to the run result
   */
  run(input: AgentInput, events: EventEmitter): Promise<AgentResult>;

  /**
   * Returns the unique identifier for this agent type.
   * Used for logging and debugging.
   *
   * @example
   * ```typescript
   * getName(): string {
   *   return 'claude';
   * }
   * ```
   */
  getName(): string;

  /**
   * Returns an optional annotation/description for this agent.
   * Displayed in the use-ai agent selector UI to help users understand
   * the agent's capabilities or purpose.
   *
   * @example
   * ```typescript
   * getAnnotation(): string | undefined {
   *   return 'Fast responses for simple tasks';
   * }
   * ```
   */
  getAnnotation?(): string | undefined;
}
