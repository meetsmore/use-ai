import type { ModelMessage, SystemModelMessage } from 'ai';
import type { EventEmitter, ClientSession } from '../types';
import type { ToolDefinition } from '../../types';
import type { Logger } from '../../logger';

/**
 * Context available to plugins during a run.
 * Contains session info, event emitter, and shared state.
 */
export interface AgentPluginContext {
  /** Unique identifier for this run */
  runId: string;
  /** Client identifier from the session */
  clientId: string;
  /** Thread identifier for the conversation */
  threadId?: string;
  /** AI provider name (e.g., 'openai', 'anthropic') */
  provider: string;
  /** Event emitter for sending AG-UI events */
  events: EventEmitter;
  /** Shared state between plugins within a single run */
  state: Map<string, unknown>;
  /** Logger instance */
  logger: Logger;
  /** The client session */
  session: ClientSession;
}

/**
 * Input data passed to onUserMessage hook.
 * Plugins can modify these values before they're sent to the AI SDK.
 */
export interface AgentRunInput {
  /** Conversation messages in AI SDK format */
  messages: ModelMessage[];
  /** System messages (if any). Passed directly to AI SDK. */
  systemMessages?: SystemModelMessage[];
  /** Available tools for this run */
  tools: ToolDefinition[];
}

/**
 * Result data passed to onAgentResponse hook.
 * Plugins can process or transform the response.
 */
export interface AgentRunResult {
  /** The generated text response */
  text: string;
  /** Sources/citations from the AI response */
  sources?: unknown[];
  /** Raw response object from AI SDK */
  response?: { messages: unknown[] };
  /** Provider-specific metadata */
  providerMetadata?: Record<string, unknown>;
  /** Tool calls made during the run */
  toolCalls?: unknown[];
  /** Results from tool executions */
  toolResults?: unknown[];
  /** Token usage information */
  usage?: { promptTokens: number; completionTokens: number };
}

/**
 * Information about a tool call (before execution).
 */
export interface ToolCallInfo {
  /** Unique identifier for this tool call */
  id: string;
  /** Name of the tool being called */
  name: string;
  /** Arguments passed to the tool */
  args: unknown;
}

/**
 * Information about a tool result (after execution).
 */
export interface ToolResultInfo extends ToolCallInfo {
  /** Result returned from the tool */
  result: unknown;
  /** Error if the tool execution failed */
  error?: Error;
}

/**
 * Plugin interface for extending AISDKAgent functionality.
 *
 * Plugins can hook into various points of the agent lifecycle to:
 * - Modify inputs before sending to AI
 * - Transform streaming chunks
 * - Intercept or modify tool calls
 * - Process and transform responses
 * - Handle errors
 *
 * @example
 * ```typescript
 * const loggingPlugin: AgentPlugin = {
 *   id: 'logging',
 *
 *   onUserMessage(input, context) {
 *     context.logger.info('User message received', {
 *       messageCount: input.messages.length,
 *     });
 *     return input;
 *   },
 *
 *   onAgentResponse(result, context) {
 *     context.logger.info('Agent response', {
 *       textLength: result.text.length,
 *     });
 *     return result;
 *   },
 * };
 * ```
 */
export interface AgentPlugin {
  /** Unique plugin identifier */
  id: string;

  /**
   * Initialize plugin (called once when agent is created).
   * Use this to set up any resources the plugin needs.
   *
   * @param context - Initialization context with provider info
   */
  initialize?(context: { provider: string }): void | Promise<void>;

  /**
   * Called before the user message is sent to AI SDK.
   * Can modify messages, system prompt, or tools.
   *
   * @param input - The input data (messages, system prompt, tools)
   * @param context - Plugin context with run info and shared state
   * @returns Modified input or unchanged input
   */
  onUserMessage?(
    input: AgentRunInput,
    context: AgentPluginContext
  ): AgentRunInput | Promise<AgentRunInput>;

  /**
   * Called after AI SDK completes processing (including all tool calls).
   * Can process results, emit events, or transform the final text.
   *
   * @param result - The agent's response data
   * @param context - Plugin context with run info and shared state
   * @returns Modified result or unchanged result
   */
  onAgentResponse?(
    result: AgentRunResult,
    context: AgentPluginContext
  ): AgentRunResult | Promise<AgentRunResult>;

  /**
   * Called for each streaming text chunk.
   * Can transform chunks. Return undefined/void to keep chunk unchanged.
   *
   * @param chunk - The text chunk being streamed
   * @param context - Plugin context with run info and shared state
   * @returns Transformed chunk, or undefined to keep original
   */
  onTextChunk?(
    chunk: string,
    context: AgentPluginContext
  ): string | void | Promise<string | void>;

  /**
   * Called before a tool is executed.
   * Can modify the tool call or return null to skip execution.
   *
   * @param toolCall - Information about the tool being called
   * @param context - Plugin context with run info and shared state
   * @returns Modified tool call, null to skip, or unchanged
   */
  onBeforeToolCall?(
    toolCall: ToolCallInfo,
    context: AgentPluginContext
  ): ToolCallInfo | null | Promise<ToolCallInfo | null>;

  /**
   * Called after a tool is executed.
   * Can modify the tool result before it's sent back to the AI.
   *
   * @param toolResult - Information about the completed tool call
   * @param context - Plugin context with run info and shared state
   * @returns Modified result or unchanged result
   */
  onAfterToolCall?(
    toolResult: ToolResultInfo,
    context: AgentPluginContext
  ): unknown | Promise<unknown>;

  /**
   * Cleanup (called when agent is destroyed).
   * Use to release any resources the plugin acquired.
   */
  destroy?(): void | Promise<void>;
}
