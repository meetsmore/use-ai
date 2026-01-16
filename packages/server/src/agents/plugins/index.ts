/**
 * Agent plugin system for extending AISDKAgent functionality.
 *
 * Plugins can hook into the agent lifecycle to:
 * - Modify inputs before sending to AI
 * - Transform streaming chunks
 * - Intercept or modify tool calls
 * - Process and transform responses
 * - Handle errors
 *
 * @example
 * ```typescript
 * import { AISDKAgent } from '@meetsmore-oss/use-ai-server';
 * import type { AgentPlugin } from '@meetsmore-oss/use-ai-server';
 *
 * const loggingPlugin: AgentPlugin = {
 *   id: 'logging',
 *   onUserMessage(input, ctx) {
 *     ctx.logger.info('Message received');
 *     return input;
 *   },
 * };
 *
 * const agent = new AISDKAgent({
 *   model: anthropic('claude-3-5-sonnet-20241022'),
 *   plugins: [loggingPlugin],
 * });
 * ```
 */

export type {
  AgentPlugin,
  AgentPluginContext,
  AgentRunInput,
  AgentRunResult,
  ToolCallInfo,
  ToolResultInfo,
} from './types';

export { AgentPluginRunner } from './runner';
