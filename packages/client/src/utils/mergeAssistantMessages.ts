import type { PersistedMessage, PersistedMessageContent } from '../providers/chatRepository/types';
import type { ReasoningPart } from '../types';
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
 * - Reasoning parts from all steps are collected into the merged message
 * - A user message marks the boundary between turns
 */
export function mergeAssistantMessagesForDisplay(messages: PersistedMessage[]): PersistedMessage[] {
  const result: PersistedMessage[] = [];
  let pendingTexts: string[] = [];
  let pendingIds: string[] = [];
  let pendingReasoningParts: ReasoningPart[] = [];

  for (const msg of messages) {
    if (msg.role === 'tool') {
      continue;
    }

    if (msg.role === 'assistant') {
      const text = getTextFromContent(msg.content);

      if (msg.toolCalls && msg.toolCalls.length > 0) {
        // Intermediate assistant with tool calls — accumulate text and reasoning, skip message
        pendingIds.push(msg.id);
        if (text) {
          pendingTexts.push(text);
        }
        if (msg.reasoningParts && msg.reasoningParts.length > 0) {
          pendingReasoningParts.push(...msg.reasoningParts);
        }
      } else {
        // Final assistant (text only) — combine with accumulated text and reasoning
        const allTexts = text
          ? [...pendingTexts, text]
          : pendingTexts;
        const combined = allTexts.join('\n\n');
        const allReasoningParts = msg.reasoningParts
          ? [...pendingReasoningParts, ...msg.reasoningParts]
          : pendingReasoningParts.length > 0 ? pendingReasoningParts : undefined;
        result.push({
          ...msg,
          content: combined || '',
          ...(allReasoningParts && allReasoningParts.length > 0 ? { reasoningParts: allReasoningParts } : {}),
        });
        pendingTexts = [];
        pendingIds = [];
        pendingReasoningParts = [];
      }
    } else {
      // User message — flush any pending text and reset for next turn
      if (pendingTexts.length > 0 || pendingReasoningParts.length > 0) {
        result.push({
          id: `merged-${pendingIds.join('-')}`,
          role: 'assistant',
          content: pendingTexts.join('\n\n'),
          createdAt: new Date(),
          ...(pendingReasoningParts.length > 0 ? { reasoningParts: pendingReasoningParts } : {}),
        });
        pendingTexts = [];
        pendingIds = [];
        pendingReasoningParts = [];
      }
      result.push(msg);
    }
  }

  // Handle trailing pending text (e.g., streaming step that hasn't finished)
  if (pendingTexts.length > 0 || pendingReasoningParts.length > 0) {
    result.push({
      id: `merged-${pendingIds.join('-')}`,
      role: 'assistant',
      content: pendingTexts.join('\n\n'),
      createdAt: new Date(),
      ...(pendingReasoningParts.length > 0 ? { reasoningParts: pendingReasoningParts } : {}),
    });
  }

  return result;
}
