export { UseAIServer } from './server';
export type { UseAIServerConfig, McpEndpointConfig, ToolDefinition, CorsOptions } from './types';
export type { ClientSession } from './server';

// Export agents for advanced usage
export type { Agent, AgentInput, EventEmitter, AgentResult } from './agents';
export { AISDKAgent, type AISDKAgentConfig, type MessageWithCacheContext, type CacheTtl, type CacheBreakpointResult, type CacheBreakpointFn } from './agents';

// Export plugin types and built-in plugins
export type { UseAIServerPlugin, MessageHandler } from './plugins';
export { FeedbackPlugin } from './plugins';

// Export logger for plugins
export { logger } from './logger';

// Export server tool definition helper and types
export { defineServerTool } from './tools';
export type { ServerToolConfig, ServerToolContext, ServerToolDefinition } from './tools';

// Export shared `_use_ai_` internal response types for consumers
export {
  isUseAIInternalResponse,
  type UseAIInternalResponseBase,
  type UseAIInternalResponse,
  isMcpConfirmationResponse,
  type McpConfirmationResponse,
} from './mcp';

// Export utilities for plugins and custom agents
export {
  createClientToolExecutor,
  isRemoteTool,
  isServerTool,
  getToolAnnotations,
  createGlobFilter,
  and,
  or,
  not,
} from './utils';
