import type { PersistedMessage, PersistedMessageContent } from '../providers/chatRepository/types';
import { getTextFromContent } from './messageContent';

/**
 * Merges consecutive assistant messages within each turn into a single
 * display message, combining their text with paragraph separators.
 *
 * This preserves the per-step data structure (needed for correct LLM context)
 * while presenting a unified view to the user.
 *
 * - Tool messages are filtered out (not shown in UI)
 * - Intermediate assistant messages (with toolCalls) have their text merged
 *   into the final text-only assistant message of the same turn
 * - A user message marks the boundary between turns
 */
export function mergeAssistantMessagesForDisplay(messages: PersistedMessage[]): PersistedMessage[] {
  const result: PersistedMessage[] = [];
  let pendingTexts: string[] = [];

  for (const msg of messages) {
    if (msg.role === 'tool') {
      continue;
    }

    if (msg.role === 'assistant') {
      const text = getTextFromContent(msg.content);

      if (msg.toolCalls && msg.toolCalls.length > 0) {
        // Intermediate assistant with tool calls — accumulate text, skip message
        if (text) {
          pendingTexts.push(text);
        }
      } else {
        // Final assistant (text only) — combine with accumulated text
        const allTexts = text
          ? [...pendingTexts, text]
          : pendingTexts;
        const combined = allTexts.join('\n\n');
        result.push({ ...msg, content: combined || '' });
        pendingTexts = [];
      }
    } else {
      // User message — flush any pending text and reset for next turn
      if (pendingTexts.length > 0) {
        result.push({
          id: `merged-${Date.now()}`,
          role: 'assistant',
          content: pendingTexts.join('\n\n'),
          createdAt: new Date(),
        });
        pendingTexts = [];
      }
      result.push(msg);
    }
  }

  // Handle trailing pending text (e.g., streaming step that hasn't finished)
  if (pendingTexts.length > 0) {
    result.push({
      id: `merged-${Date.now()}`,
      role: 'assistant',
      content: pendingTexts.join('\n\n'),
      createdAt: new Date(),
    });
  }

  return result;
}
