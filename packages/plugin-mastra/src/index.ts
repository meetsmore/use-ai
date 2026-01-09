/**
 * Mastra workflow agent plugin for use-ai server.
 *
 * This plugin allows you to use Mastra (https://mastra.ai) workflows
 * as agents in the use-ai server.
 *
 * @example
 * ```typescript
 * import { UseAIServer, AISDKAgent } from '@meetsmore/use-ai-server';
 * import { MastraWorkflowAgent } from '@meetsmore/use-ai-plugin-mastra';
 * import { Mastra } from '@mastra/core';
 * import { anthropic } from '@ai-sdk/anthropic';
 *
 * // Create Mastra instance with your workflows
 * const mastra = new Mastra({
 *   agents: { helpAgent, searchAgent },
 *   workflows: { universalWorkflow },
 * });
 *
 * const server = new UseAIServer({
 *   agents: {
 *     claude: new AISDKAgent({ model: anthropic('claude-3-5-sonnet-20241022') }),
 *     support: new MastraWorkflowAgent(mastra, { workflowId: 'universalWorkflow' }),
 *   },
 *   defaultAgent: 'claude',
 * });
 * ```
 *
 * @packageDocumentation
 */

export { MastraWorkflowAgent, type MastraWorkflowAgentConfig } from './MastraWorkflowAgent';
export { pipeFullStreamWithToolEvents, type PipeFullStreamResult } from './streamHelpers';
// Re-export for convenience
export { convertToolsToAISDKFormat, type ConvertToolsToAISDKFormatOptions } from './utils/toolConverter';
export {
  mastraWorkflowInputSchema,
  mastraWorkflowOutputSchema,
  type MastraWorkflowInput,
  type MastraWorkflowOutput,
  type Tool,
  type ModelMessage,
} from './types';
