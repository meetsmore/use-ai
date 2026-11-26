import type { PersistedMessage } from '../providers/chatRepository/types';
import type { ChatStreamingPart, ChatToolCallStatus } from '../hooks/useServerEvents';
import { getTextFromContent } from './messageContent';

/** Parses JSON, or returns undefined when the text is not JSON, e.g. a tool that returned plain text. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Whether a tool's result reports a failure: `{ error: ... }` (what a thrown
 * tool comes back as) or `{ success: false }`. An `error` of `null`, `undefined`
 * or `false` means no error, so a result like `{ data, error: null }` succeeded.
 */
export function isErrorResult(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (record.error != null && record.error !== false) || record.success === false;
}

/**
 * Decides a finished tool call's status from its result, the same way while
 * the answer streams and after the chat is reloaded. It reads the shapes
 * use-ai itself writes:
 *
 * - `'{"aborted":true,...}'` → `aborted` (the run stopped before the call returned)
 * - `'{"rejected":true,...}'` → `rejected` (the user rejected the call)
 * - `'{"error":"Not found"}'` or `'{"success":false}'` → `error` (see {@link isErrorResult})
 * - anything else, including text that is not JSON → `done`
 *
 * @param result the result as kept in the conversation history
 */
export function getToolCallStatus(result: string): Extract<ChatToolCallStatus, 'done' | 'error' | 'rejected' | 'aborted'> {
  const value = parseJson(result);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'done';
  const record = value as Record<string, unknown>;
  if (record.aborted === true) return 'aborted';
  if (record.rejected === true) return 'rejected';
  if (isErrorResult(record)) return 'error';
  return 'done';
}

/**
 * Rebuilds a persisted turn as the ordered parts a run streams, so a message
 * slot can draw a turn the same way while it streams (`streamingParts`) and
 * after it is saved (`sourceMessages`). Each step contributes its reasoning,
 * then its text, then its tool calls, the order the model produces them in.
 * A tool call takes its result from the turn's `tool` message; one with no
 * result never returned, so it reads as `aborted`.
 *
 * @example
 * ```tsx
 * function Message({ streaming, streamingParts, sourceMessages }: ChatMessageSlotProps) {
 *   const parts = streaming ? streamingParts : getTurnParts(sourceMessages);
 *   return parts.map((part, index) =>
 *     part.kind === 'tool_call' ? <ToolRow key={index} name={part.name} status={part.status} /> : ...
 *   );
 * }
 * ```
 */
export function getTurnParts(sourceMessages: PersistedMessage[]): ChatStreamingPart[] {
  const results = new Map<string, string>();
  for (const message of sourceMessages) {
    if (message.role === 'tool' && message.toolCallId) {
      // Chats saved before tools that return nothing were recorded as "null"
      // have tool messages without content.
      results.set(message.toolCallId, message.content === undefined ? '' : getTextFromContent(message.content));
    }
  }

  const parts: ChatStreamingPart[] = [];
  for (const message of sourceMessages) {
    if (message.role !== 'assistant') continue;
    for (const reasoning of message.reasoningParts ?? []) {
      parts.push({ kind: 'reasoning', text: reasoning.text });
    }
    const text = getTextFromContent(message.content);
    if (text) parts.push({ kind: 'text', text, messageId: message.id });
    for (const toolCall of message.toolCalls ?? []) {
      const result = results.get(toolCall.id);
      parts.push({
        kind: 'tool_call',
        toolCallId: toolCall.id,
        name: toolCall.function.name,
        args: toolCall.function.arguments,
        ...(result === undefined ? { status: 'aborted' } : { status: getToolCallStatus(result), result }),
      });
    }
  }
  return parts;
}
