/**
 * Agents module for use-ai server.
 * Provides pluggable AI agent backends that emit AG-UI protocol events.
 */

export type { Agent, AgentInput, EventEmitter, AgentResult, ClientSession } from './types';
export { AISDKAgent, type AISDKAgentConfig } from './AISDKAgent';
export {
  applyCacheBreakpoints,
  isAnthropicModel,
  type MessageWithCacheContext,
  type CacheTtl,
  type CacheBreakpointResult,
  type CacheBreakpointFn,
} from './anthropicCache';
