/**
 * CORS configuration options.
 *
 * @example
 * ```typescript
 * cors: {
 *   origin: true,                    // Allow all origins
 *   origin: 'https://example.com',   // Allow specific origin
 *   origin: /\.example\.com$/,       // Allow origins matching pattern
 *   origin: ['https://a.com', /\.b\.com$/], // Allow multiple
 *   methods: ['GET', 'POST'],
 *   credentials: true,
 * }
 * ```
 */
export interface CorsOptions {
  /**
   * Configures the Access-Control-Allow-Origin header.
   * - `true` or `'*'`: Reflects the request origin (allows all origins)
   * - `string`: Sets a specific origin (e.g., 'https://example.com')
   * - `RegExp`: Allows origins matching the pattern
   * - `Array`: Allows origins matching any of the string/RegExp values
   */
  origin?: boolean | string | RegExp | (string | RegExp)[];
  /**
   * Configures the Access-Control-Allow-Methods header for preflight requests.
   * @default ['GET', 'POST']
   */
  methods?: string | string[];
  /**
   * Configures the Access-Control-Allow-Credentials header.
   * Set to true to pass the header, otherwise it is omitted.
   */
  credentials?: boolean;
}

/**
 * Configuration for an MCP (Model Context Protocol) endpoint.
 * MCP endpoints provide tools that can be discovered and executed server-side.
 */
export interface McpEndpointConfig {
  /** The full HTTP URL of the MCP endpoint (e.g., 'http://backend.com/mcp') */
  url: string;
  /** Optional HTTP headers for authentication (e.g., { 'Authorization': 'Bearer token' }) */
  headers?: Record<string, string>;
  /**
   * Tool execution timeout in milliseconds.
   * Default: 30000 (30 seconds)
   */
  timeout?: number;
  /**
   * Optional namespace prefix for tools from this endpoint.
   * Useful to avoid naming conflicts when using multiple MCP endpoints.
   * Example: namespace='backend' → tool 'calculator' becomes 'backend_calculator'
   */
  namespace?: string;
  /**
   * Cache TTL for tool lists in milliseconds.
   * After this duration, tools are re-fetched on next run_agent.
   * Default: 0 (cache for entire session, no TTL)
   */
  toolsCacheTtl?: number;
}

/**
 * Configuration options for the UseAI server.
 *
 * @template TAgents - Object mapping agent names to agent instances
 */
export interface UseAIServerConfig<TAgents extends Record<string, import('./agents/types').Agent> = Record<string, import('./agents/types').Agent>> {
  /** Object mapping agent names to agent instances. */
  agents: TAgents;
  /** Name of the default agent to use for chat (run_agent). Must be a key in agents object. */
  defaultAgent: keyof TAgents & string;
  /** The port number for the WebSocket server. Default: 8081 */
  port?: number;
  /** Maximum number of requests allowed per time window. Set to 0 to disable rate limiting. Default: 0 */
  rateLimitMaxRequests?: number;
  /** Time window in milliseconds for rate limiting. Default: 60000 (1 minute) */
  rateLimitWindowMs?: number;
  /** Optional array of plugins to extend server functionality */
  plugins?: import('./plugins/types').UseAIServerPlugin[];
  /**
   * Optional array of MCP endpoints to fetch tools from.
   * Tools from these endpoints will be automatically available to all agents and workflows.
   */
  mcpEndpoints?: McpEndpointConfig[];
  /**
   * Maximum HTTP buffer size in bytes for Socket.IO payloads.
   * Increase this if you need to support larger file uploads.
   * Default: 20MB (20 * 1024 * 1024)
   */
  maxHttpBufferSize?: number;
  /**
   * CORS configuration for Socket.IO server.
   * Controls which origins can connect to the WebSocket server.
   *
   * Default: undefined
   *
   * For production with sticky sessions (cookie-based load balancing):
   * ```typescript
   * cors: {
   *   origin: 'https://your-frontend.com',
   *   methods: ['GET', 'POST'],
   *   credentials: true,
   * }
   * ```
   *
   * @see https://socket.io/docs/v4/handling-cors/
   * @see https://socket.io/docs/v4/using-multiple-nodes/
   */
  cors?: CorsOptions;
  /**
   * Idle timeout in seconds for the Bun server.
   * Must be greater than the pingInterval option (25 seconds by default).
   * Default: 30
   */
  idleTimeout?: number;
}

// Re-export all types from @meetsmore-oss/use-ai-core
export type {
  ToolDefinition,
  ClientMessage,
  // AG-UI types
  Tool,
  Message,
  Context,
  RunAgentInput,
  State,
  RunAgentMessage,
  ToolResultMessage,
  AbortRunMessage,
  // AG-UI event types
  RunStartedEvent,
  RunFinishedEvent,
  RunErrorEvent,
  StepStartedEvent,
  StepFinishedEvent,
  TextMessageStartEvent,
  TextMessageContentEvent,
  TextMessageEndEvent,
  TextMessageChunkEvent,
  ToolCallStartEvent,
  ToolCallArgsEvent,
  ToolCallEndEvent,
  ToolCallChunkEvent,
  ToolCallResultEvent,
  StateSnapshotEvent,
  StateDeltaEvent,
  MessagesSnapshotEvent,
  RawEvent,
  CustomEvent,
  ActivitySnapshotEvent,
  ActivityDeltaEvent,
  AGUIEvent,
  // use-ai extensions
  WorkflowStatus,
  UseAIClientMessage,
  RunWorkflowMessage,
} from '@meetsmore-oss/use-ai-core';

export { EventType, ErrorCode } from '@meetsmore-oss/use-ai-core';
