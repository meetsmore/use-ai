import { modelMessageSchema } from 'ai';
import { z } from 'zod';
import type { ModelMessage, Tool } from 'ai';

/**
 * Zod schema for Mastra workflow input.
 *
 * Use this schema when defining Mastra workflows that integrate with use-ai.
 * MastraWorkflowAgent will pass data conforming to this schema.
 *
 * @example
 * ```typescript
 * import { createWorkflow, createStep } from '@mastra/core/workflows';
 * import { mastraWorkflowInputSchema } from '@meetsmore-oss/use-ai-plugin-mastra';
 *
 * const myWorkflow = createWorkflow({
 *   id: 'my-workflow',
 *   inputSchema: mastraWorkflowInputSchema,
 *   // ...
 * });
 * ```
 */
export const mastraWorkflowInputSchema = z.object({
  /** Conversation history in AI SDK ModelMessage format */
  messages: z.array(modelMessageSchema),
  /** Optional system prompt to guide the agent */
  systemPrompt: z.string().optional(),
  /** Client tools converted to AI SDK format (opaque object) */
  clientTools: z.record(z.string(), z.any()).optional(),
});

/**
 * TypeScript type for Mastra workflow input.
 * Inferred from the Zod schema.
 */
export type MastraWorkflowInput = z.infer<typeof mastraWorkflowInputSchema>;

/**
 * Zod schema for Mastra workflow output.
 *
 * All workflows must return data conforming to this schema.
 * This enables MastraWorkflowAgent to handle any workflow uniformly.
 *
 * @example
 * ```typescript
 * import { createWorkflow, createStep } from '@mastra/core/workflows';
 * import { mastraWorkflowInputSchema, mastraWorkflowOutputSchema } from '@meetsmore-oss/use-ai-plugin-mastra';
 *
 * const myWorkflow = createWorkflow({
 *   id: 'my-workflow',
 *   inputSchema: mastraWorkflowInputSchema,
 *   outputSchema: mastraWorkflowOutputSchema,
 *   // ...
 * });
 * ```
 */
export const mastraWorkflowOutputSchema = z.object({
  /** Whether the workflow completed successfully */
  success: z.boolean(),
  /** Error message if the workflow failed */
  error: z.string().optional(),
  /** The final text answer from the workflow */
  finalAnswer: z.string(),
  /** Updated conversation history (from agent.generate().response.messages) */
  conversationHistory: z.array(modelMessageSchema),
});

/**
 * TypeScript type for Mastra workflow output.
 * Inferred from the Zod schema.
 */
export type MastraWorkflowOutput = z.infer<typeof mastraWorkflowOutputSchema>;

/**
 * Re-export Tool type for convenience when defining clientTools.
 */
export type { Tool, ModelMessage };
