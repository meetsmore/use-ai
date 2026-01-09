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
}

// Re-export all types from @meetsmore/use-ai-core
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
} from '@meetsmore/use-ai-core';

export { EventType, ErrorCode } from '@meetsmore/use-ai-core';
