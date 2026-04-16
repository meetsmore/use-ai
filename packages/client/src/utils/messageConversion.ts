import type { PersistedMessage } from '../providers/chatRepository/types';
import type { Message as AGUIMessage, Message, ReasoningPart } from '../types';
import { getTextFromContent } from './messageContent';

/**
 * Transforms persisted messages to AG-UI message format for loading into client.
 * Preserves toolCalls on assistant messages and toolCallId on tool messages
 * so the server can reconstruct valid API messages.
 */
export function transformMessagesToClientFormat(persistedMessages: PersistedMessage[]): AGUIMessage[] {
  return persistedMessages.map((msg): AGUIMessage => {
    const textContent = getTextFromContent(msg.content);

    switch (msg.role) {
      case 'tool':
        return {
          id: msg.id,
          role: 'tool',
          content: textContent,
          toolCallId: msg.toolCallId || '',
        };
      case 'assistant':
        return {
          id: msg.id,
          role: 'assistant',
          content: textContent,
          ...(msg.toolCalls && msg.toolCalls.length > 0 ? { toolCalls: msg.toolCalls } : {}),
          ...(msg.reasoningParts && msg.reasoningParts.length > 0 ? { reasoningParts: msg.reasoningParts } : {}),
        };
      case 'user':
        return {
          id: msg.id,
          role: 'user',
          content: textContent,
        };
    }
  });
}

/**
 * Extracts intermediate turn messages (assistant messages with tool calls and
 * tool result messages) from the client message history, starting from
 * `startIndex`. Converts them to `PersistedMessage[]` for storage.
 *
 * The final text-only assistant message is excluded here because it is
 * saved separately by `saveAIResponse`.
 *
 * Messages in `client._messages` are already in correct API order
 * (assistant(toolCalls) → tool results → assistant(text)) since the client
 * flushes per-step messages at STEP_FINISHED (or at RUN_FINISHED for
 * backward compatibility when the server does not emit step events).
 */
export function extractTurnMessages(messages: Message[], startIndex: number): PersistedMessage[] {
  const turnSlice = messages.slice(startIndex);
  const result: PersistedMessage[] = [];

  for (const msg of turnSlice) {
    if (msg.role === 'assistant' && 'toolCalls' in msg && msg.toolCalls) {
      const reasoningParts = ('reasoningParts' in msg && msg.reasoningParts)
        ? msg.reasoningParts as ReasoningPart[]
        : undefined;
      result.push({
        id: msg.id,
        role: 'assistant',
        content: typeof msg.content === 'string' ? msg.content : '',
        createdAt: new Date(),
        toolCalls: msg.toolCalls as PersistedMessage['toolCalls'],
        ...(reasoningParts ? { reasoningParts } : {}),
      });
    } else if (msg.role === 'tool') {
      result.push({
        id: msg.id,
        role: 'tool',
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        createdAt: new Date(),
        toolCallId: ('toolCallId' in msg && msg.toolCallId) ? msg.toolCallId as string : undefined,
      });
    }
  }

  return result;
}
