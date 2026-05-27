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
 * - `info` notices (e.g. the abort bubble) are standalone system messages: they
 *   are never merged into assistant turn content, and they flush any pending
 *   text into its own message first so it doesn't fold into the notice.
 */
export function mergeAssistantMessagesForDisplay(messages: PersistedMessage[]): PersistedMessage[] {
  const result: PersistedMessage[] = [];
  let pendingTexts: string[] = [];
  let pendingIds: string[] = [];
  let pendingReasoningParts: ReasoningPart[] = [];

  const flushPending = () => {
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
  };

  for (const msg of messages) {
    if (msg.role === 'tool') {
      continue;
    }

    if (msg.displayMode === 'info') {
      // System notice — flush the in-progress assistant text as its own
      // message, then keep the notice standalone (no merge, no displayMode leak).
      flushPending();
      result.push(msg);
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
      flushPending();
      result.push(msg);
    }
  }

  // Handle trailing pending text (e.g., streaming step that hasn't finished)
  flushPending();

  return result;
}
