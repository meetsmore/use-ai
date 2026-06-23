import type { PersistedMessage } from '../providers/chatRepository/types';
import type { Message as AGUIMessage, Message, MultimodalContent, ReasoningPart } from '../types';
import { getTextFromContent } from './messageContent';

/**
 * Transforms persisted messages to AG-UI message format for loading into client.
 * Preserves toolCalls on assistant messages and toolCallId on tool messages
 * so the server can reconstruct valid API messages.
 */
export function transformMessagesToClientFormat(persistedMessages: PersistedMessage[]): AGUIMessage[] {
  return persistedMessages.map((msg): AGUIMessage => {
    switch (msg.role) {
      case 'tool':
        return {
          id: msg.id,
          role: 'tool',
          content: getTextFromContent(msg.content),
          toolCallId: msg.toolCallId || '',
        };
      case 'assistant':
        return {
          id: msg.id,
          role: 'assistant',
          content: getTextFromContent(msg.content),
          ...(msg.toolCalls && msg.toolCalls.length > 0 ? { toolCalls: msg.toolCalls } : {}),
          ...(msg.reasoningParts && msg.reasoningParts.length > 0 ? { reasoningParts: msg.reasoningParts } : {}),
        };
      case 'user': {
        if (typeof msg.content === 'string') {
          return { id: msg.id, role: 'user', content: msg.content };
        }
        // Preserve multipart structure so the LLM sees the full original
        // input (including transformed file text) after rehydration.
        // transformed_file parts are wrapped in the same format the server
        // emits on fresh sends (see packages/server/src/server.ts).
        //
        // The wire parts below intentionally use use-ai's content shape
        // ({ type:'image'|'file', ref }) — the canonical MultimodalContent — rather
        // than AG-UI's `source`-based content, matching what client.sendPrompt emits.
        // AG-UI's Message['content'] is structurally a different (source-based) shape,
        // so the boundary cast below is required (a tighter cast would only compile by
        // accident); client.sendPrompt casts the same way for the same reason.
        const parts = msg.content.flatMap((p): MultimodalContent[] => {
          if (p.type === 'text') {
            return [{ type: 'text', text: p.text }];
          }
          if (p.type === 'transformed_file') {
            return [{
              type: 'text',
              text: `[Content of file "${p.originalFile.name}" (${p.originalFile.mimeType})]:\n\n${p.text}`,
            }];
          }
          if (p.type === 'stored_file') {
            // Re-sendable: restore the ref wire part so the run-start resolver
            // turns it back into a signed URL. Image vs file decided by mimeType.
            return [
              p.mimeType.startsWith('image/')
                ? { type: 'image', ref: p.ref }
                : { type: 'file', ref: p.ref, mimeType: p.mimeType, name: p.name },
            ];
          }
          // Legacy metadata-only 'file' parts cannot be reconstructed —
          // drop them so the rest of the history still loads.
          return [];
        });
        return {
          id: msg.id,
          role: 'user',
          content: parts as unknown as Extract<AGUIMessage, { role: 'user' }>['content'],
        };
      }
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
