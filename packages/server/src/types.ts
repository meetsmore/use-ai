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
   * Optional server-side tools available to all agents.
   * These tools execute directly in the server process (no HTTP or WebSocket round-trip).
   * Use defineServerTool() to create tool configs.
   *
   * @example
   * ```typescript
   * tools: {
   *   getWeather: defineServerTool(
   *     'Get current weather',
   *     z.object({ city: z.string() }),
   *     async ({ city }) => fetchWeather(city)
   *   ),
   * }
   * ```
   */
  tools?: Record<string, import('./tools/types').ServerToolConfig>;
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
   * Idle timeout in seconds for the HTTP server.
   * Only used by the Bun runtime (ignored by Node.js).
   * Must be greater than the pingInterval option (25 seconds by default).
   * @default 30
   */
  idleTimeout?: number;
  /**
   * The runtime to use for the server.
   * - 'auto': Automatically detect the runtime (Bun or Node.js)
   * - 'bun': Force Bun runtime (will throw if not running on Bun)
   * - 'node': Force Node.js runtime (will throw if not running on Node.js)
   * @default 'auto'
   */
  runtime?: 'auto' | 'bun' | 'node';
  /**
   * Optional additional OpenTelemetry span processors.
   * These are registered alongside the built-in Langfuse and traceId capture processors.
   *
   * @example
   * ```typescript
   * import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
   * import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
   *
   * const exporter = new OTLPTraceExporter({ url: 'http://localhost:4318/v1/traces' });
   * const server = new UseAIServer({
   *   agents: { claude: claudeAgent },
   *   defaultAgent: 'claude',
   *   spanProcessors: [new SimpleSpanProcessor(exporter)],
   * });
   * ```
   */
  spanProcessors?: import('./instrumentation').SpanProcessor[];
  /**
   * Optional host seam that resolves attachment refs into content the model can read.
   *
   * The host converts each ref into a part use-ai understands (`{ type:'image', url }` /
   * `{ type:'file', url, mimeType, name }` / a `{ type:'text', text }` fallback when
   * the attachment is missing or unfetchable) and returns it.
   * When omitted, ref-bearing parts pass through unresolved and are silently dropped
   * during conversion (the attachment never reaches the model). See @see ResolveAttachments
   * for the full contract.
   */
  resolveAttachments?: import('@meetsmore-oss/use-ai-core').ResolveAttachments;
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
  ToolAnnotations,
  ToolCallStartExtensions,
  WorkflowStatus,
  UseAIClientMessage,
  RunWorkflowMessage,
  UseAIForwardedProps,
  // Tool approval types
  ToolApprovalRequestEvent,
  ToolApprovalResponseMessage,
  // Reasoning event types (AG-UI protocol)
  ReasoningStartEvent,
  ReasoningMessageStartEvent,
  ReasoningMessageContentEvent,
  ReasoningMessageEndEvent,
  ReasoningEndEvent,
  ReasoningEncryptedValueEvent,
  ReasoningPart,
  // Multimodal content + attachment ref resolution
  MultimodalContent,
  ResolveAttachments,
  ResolveAttachmentsContext,
} from '@meetsmore-oss/use-ai-core';

export { EventType, ErrorCode, TOOL_APPROVAL_REQUEST } from '@meetsmore-oss/use-ai-core';
