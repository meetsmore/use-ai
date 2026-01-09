/**
 * Stream helper utilities for Mastra workflow steps.
 *
 * These helpers simplify the integration of Mastra agent streams
 * with use-ai's AG-UI protocol, particularly for tool call events.
 *
 * Updated for @mastra/core 1.0.0-beta which changed the stream chunk structure.
 */

/**
 * Chunk types from Mastra agent fullStream
 */
interface FullStreamChunk {
  type: string;
  payload?: unknown;
}

/**
 * Writer interface for Mastra workflow steps
 */
interface WorkflowStepWriter {
  write(data: string): Promise<void>;
  custom(data: unknown): Promise<void>;
}

/**
 * Mastra agent stream interface (subset of what we need)
 */
interface MastraAgentStream {
  fullStream: AsyncIterable<FullStreamChunk>;
  text: Promise<string>;
}

/**
 * Result of piping a full stream with tool events
 */
export interface PipeFullStreamResult {
  /** The final aggregated text from the stream */
  text: string;
}

/**
 * Pipes an agent's fullStream to a workflow step writer, emitting both
 * text content and tool call events as custom chunks.
 *
 * This helper simplifies the common pattern of iterating over fullStream
 * and routing different chunk types to the appropriate writer methods.
 *
 * Tool call events are emitted as custom chunks with the following types:
 * - `tool-call-start`: When a tool call begins (includes toolCallId, toolName)
 * - `tool-call-args`: Tool call arguments as JSON string (includes toolCallId, delta)
 * - `tool-call-end`: When a tool call's arguments are complete (includes toolCallId)
 *
 * These custom chunks are then processed by MastraWorkflowAgent to emit
 * AG-UI protocol events (TOOL_CALL_START, TOOL_CALL_ARGS, TOOL_CALL_END).
 *
 * @param stream - The Mastra agent stream (from agent.stream())
 * @param writer - The workflow step writer
 * @returns The final aggregated text from the stream
 *
 * @example
 * ```typescript
 * import { createStep } from '@mastra/core/workflows';
 * import { pipeFullStreamWithToolEvents } from '@meetsmore-oss/use-ai-plugin-mastra';
 *
 * const agentStep = createStep({
 *   id: 'agent-step',
 *   inputSchema: mastraWorkflowInputSchema,
 *   outputSchema: mastraWorkflowOutputSchema,
 *   execute: async ({ inputData, mastra, writer }) => {
 *     const agent = mastra?.getAgent('myAgent');
 *     const stream = await agent?.stream(inputData.messages);
 *
 *     const { text } = await pipeFullStreamWithToolEvents(stream!, writer!);
 *
 *     return {
 *       success: true,
 *       finalAnswer: text,
 *       conversationHistory: [],
 *     };
 *   },
 * });
 * ```
 */
export async function pipeFullStreamWithToolEvents(
  stream: MastraAgentStream,
  writer: WorkflowStepWriter
): Promise<PipeFullStreamResult> {
  let text = '';
  // Track which tool calls have received args via tool-call-delta
  const toolCallsWithArgs = new Set<string>();

  for await (const chunk of stream.fullStream) {
    switch (chunk.type) {
      case 'text-delta': {
        const textDelta = (chunk.payload as { text: string })?.text;
        if (textDelta) {
          await writer.write(textDelta);
          text += textDelta;
        }
        break;
      }

      // Streaming tool call events from @mastra/core
      case 'tool-call-input-streaming-start': {
        const chunkPayload = chunk.payload as { toolCallId?: string; toolName?: string } | undefined;
        // Nest data in payload for Mastra workflow stream to pass through
        await writer.custom({
          type: 'tool-call-start',
          payload: {
            toolCallId: chunkPayload?.toolCallId,
            toolName: chunkPayload?.toolName,
          },
        });
        break;
      }

      case 'tool-call-delta': {
        const chunkPayload = chunk.payload as { toolCallId?: string; argsTextDelta?: string } | undefined;
        if (chunkPayload?.toolCallId) {
          toolCallsWithArgs.add(chunkPayload.toolCallId);
        }
        if (chunkPayload?.argsTextDelta) {
          await writer.custom({
            type: 'tool-call-args',
            payload: {
              toolCallId: chunkPayload?.toolCallId,
              delta: chunkPayload?.argsTextDelta,
            },
          });
        }
        break;
      }

      case 'tool-call-input-streaming-end': {
        // Do NOT emit tool-call-end here.
        // This chunk only signals that argument streaming is complete,
        // but execute() hasn't been called yet.
        break;
      }

      case 'tool-call': {
        // Tool is being called - emit tool-call-end
        // tool-call-start and tool-call-args are already emitted via
        // tool-call-input-streaming-start and tool-call-delta events
        const chunkPayload = chunk.payload as {
          toolCallId?: string;
        } | undefined;

        // If no args were streamed (tool has no arguments), send empty object
        // Client expects valid JSON, so we must send at least "{}"
        if (chunkPayload?.toolCallId && !toolCallsWithArgs.has(chunkPayload.toolCallId)) {
          await writer.custom({
            type: 'tool-call-args',
            payload: {
              toolCallId: chunkPayload.toolCallId,
              delta: '{}',
            },
          });
        }

        await writer.custom({
          type: 'tool-call-end',
          payload: {
            toolCallId: chunkPayload?.toolCallId,
          },
        });
        break;
      }

      // Other chunk types (tool-result, step-start, finish, etc.) are ignored
      // as they are handled internally by Mastra or not needed for AG-UI
    }
  }

  return { text };
}
