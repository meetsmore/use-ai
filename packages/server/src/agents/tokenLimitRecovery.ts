/**
 * Token limit truncation recovery for AI SDK Agent.
 *
 * When the model's output token limit (maxOutputTokens) is exceeded mid-stream,
 * tool-input-start fires but tool-call never fires — leaving tool calls incomplete.
 * This module detects that condition and builds synthetic error tool_results so the
 * model can retry with smaller arguments.
 *
 * NOTE: We intentionally do NOT emit TOOL_CALL_END for incomplete calls.
 * The client's TOOL_CALL_END handler parses args as JSON and executes the tool,
 * which would fail on truncated JSON. Client-side cleanup of executingTool is
 * handled instead by the RUN_FINISHED/RUN_ERROR handlers.
 */

import type { ModelMessage } from 'ai';

export interface ActiveToolCall {
  name: string;
  args: string;
}

/**
 * Builds recovery messages for tool calls that were truncated by the output token limit.
 *
 * Returns an array of [assistantMessage, ...toolResultMessages] to inject into the
 * conversation history so the model can retry with shorter arguments.
 * Returns null if no recovery is needed.
 *
 * @param activeToolCalls - All tool calls that were started in this step
 * @param completedToolCalls - Tool calls that completed successfully (received tool-call chunk)
 * @param stepFinishReason - The finish reason from the stream
 * @param maxOutputTokens - The configured max output tokens (for error messages)
 */
export function buildTokenLimitRecoveryMessages(
  activeToolCalls: Map<string, ActiveToolCall>,
  completedToolCalls: Set<string>,
  stepFinishReason: string | undefined,
  maxOutputTokens: number,
): ModelMessage[] | null {
  const incompleteToolCallIds = [...activeToolCalls.keys()].filter(
    id => !completedToolCalls.has(id),
  );

  // Guard with finishReason === 'length' to avoid false-positive recovery on other stream errors.
  if (incompleteToolCallIds.length === 0 || stepFinishReason !== 'length') {
    return null;
  }

  const recoveryAssistantContent: Array<{
    type: 'tool-call';
    toolCallId: string;
    toolName: string;
    input: Record<string, never>;
  }> = [];
  const recoveryToolResults: ModelMessage[] = [];

  for (const toolCallId of incompleteToolCallIds) {
    const toolCall = activeToolCalls.get(toolCallId)!;
    const truncatedArgsLength = toolCall.args.length;

    recoveryAssistantContent.push({
      type: 'tool-call',
      toolCallId,
      toolName: toolCall.name,
      input: {},
    });

    recoveryToolResults.push({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId,
          toolName: toolCall.name,
          output: {
            type: 'text',
            value: [
              `Error: Your tool call for "${toolCall.name}" was truncated by the output token limit (maxOutputTokens: ${maxOutputTokens}).`,
              `The arguments were cut off at ${truncatedArgsLength} characters of JSON, so this call was recorded with empty args ({}) as a placeholder — do NOT retry "${toolCall.name}" with empty args.`,
              `Truncated args (first 200 chars): ${toolCall.args.substring(0, 200)}`,
              `You MUST split this into multiple smaller tool calls, each with fewer items/shorter data.`,
            ].join('\n'),
          },
          isError: true,
        },
      ],
    } as unknown as ModelMessage);
  }

  const recoveryAssistantMessage: ModelMessage = {
    role: 'assistant',
    content: recoveryAssistantContent,
  } as ModelMessage;

  return [recoveryAssistantMessage, ...recoveryToolResults];
}
