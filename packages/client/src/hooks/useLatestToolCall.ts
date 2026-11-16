import { useContext, useMemo } from 'react';
import { __UseAIChatContext } from '../components/UseAIChat';
import type { ChatStreamingPart, ChatToolCallPart, ChatToolCallStatus } from './useServerEvents';
import { getTurnParts, parseJson } from '../utils/toolCalls';

/** The latest call of a tool, as returned by {@link useLatestToolCall}. */
export interface LatestToolCall<Args = unknown, Result = unknown> {
  /** @example "toolu_01abc123" */
  toolCallId: string;
  status: ChatToolCallStatus;
  /** The parsed arguments, e.g. `{ items: [{ title: 'Read the spec', done: true }] }`. */
  args: Args;
  /** The parsed result (the raw string when it is not JSON), once the call has one. */
  result?: Result;
  /**
   * Whether the call belongs to the answer being streamed right now. False
   * once that answer has finished, so state that only lasts while the AI
   * works (a todo list) can be hidden then.
   */
  streaming: boolean;
}

function findLatest(parts: ChatStreamingPart[], toolName: string): ChatToolCallPart | undefined {
  for (let index = parts.length - 1; index >= 0; index--) {
    const part = parts[index];
    if (part.kind === 'tool_call' && part.name === toolName && part.status !== 'receiving-args') return part;
  }
  return undefined;
}

/**
 * Finds the latest call of a tool in the displayed chat: in the answer being
 * streamed first, then back through the saved messages. Use it for state that
 * does not belong inside one answer and is drawn wherever the app wants, such
 * as a todo list above the composer while the AI works.
 *
 * A call whose arguments are still arriving is skipped, so what is drawn does
 * not pass through half-received states. Returns null when the tool has not
 * been called in this chat, or outside a `UseAIProvider`.
 *
 * @param toolName the name the tool is called by, with the `useAI` id prefix
 * when it has one, e.g. "update_todos" or "Row 1_updateLabel"
 *
 * @example
 * ```tsx
 * function TodoPanel() {
 *   const latest = useLatestToolCall<{ items: Todo[] }>('update_todos');
 *   if (!latest?.streaming) return null;
 *   return <TodoList items={latest.args.items} />;
 * }
 * ```
 */
export function useLatestToolCall<Args = unknown, Result = unknown>(toolName: string): LatestToolCall<Args, Result> | null {
  const chat = useContext(__UseAIChatContext);
  const messages = chat?.messages;
  const streamingParts = chat?.streamingParts;

  // Searched apart from the streamed answer, which changes on every token
  // while the saved messages do not.
  const savedPart = useMemo(
    () => (messages ? findLatest(getTurnParts(messages), toolName) : undefined),
    [messages, toolName],
  );
  const streamedPart = useMemo(
    () => (streamingParts ? findLatest(streamingParts, toolName) : undefined),
    [streamingParts, toolName],
  );
  const part = streamedPart ?? savedPart;
  const streaming = streamedPart !== undefined;

  // Keyed on the part, so the result (and its parsed args) keeps its identity
  // while other parts of the answer stream.
  return useMemo(() => {
    if (!part) return null;

    const result = part.result === undefined ? undefined : (parseJson(part.result) ?? part.result);
    return {
      toolCallId: part.toolCallId,
      status: part.status,
      args: parseJson(part.args) as Args,
      ...(result === undefined ? {} : { result: result as Result }),
      streaming,
    };
  }, [part, streaming]);
}
