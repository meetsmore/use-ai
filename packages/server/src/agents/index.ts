/**
 * Agents module for use-ai server.
 * Provides pluggable AI agent backends that emit AG-UI protocol events.
 */

export type { Agent, AgentInput, EventEmitter, AgentResult, ClientSession } from './types';
export { AISDKAgent, type AISDKAgentConfig } from './AISDKAgent';

// Export agent plugin types
export type {
  AgentPlugin,
  AgentPluginContext,
  AgentRunInput,
  AgentRunResult,
  ToolCallInfo,
  ToolResultInfo,
} from './plugins';
export { AgentPluginRunner } from './plugins';
