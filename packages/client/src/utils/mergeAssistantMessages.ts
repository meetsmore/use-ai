import type { PersistedMessage, PersistedMessageContent } from '../providers/chatRepository/types';
import type { ReasoningPart } from '../types';
import { getTextFromContent } from './messageContent';

/**
 * A display message plus the raw messages it was built from, in the order they
 * were produced. Merging is lossy on purpose (see below), so `sourceMessages`
 * keeps the per-step tool calls, tool results and reasoning available to
 * anything that wants to render the turn as a timeline rather than one bubble.
 */
export type MergedMessage = PersistedMessage & { sourceMessages: PersistedMessage[] };

/**
 * Merges consecutive assistant messages within each turn into a single
 * display message, combining their text with paragraph separators.
 *
 * This preserves the per-step data structure (needed for correct LLM context)
 * while presenting a unified view to the user.
 *
 * - Tool messages are filtered out of the merged content, but stay in the
 *   turn's `sourceMessages`
 * - Intermediate assistant messages (with toolCalls) have their text merged
 *   into the final text-only assistant message of the same turn
 * - Reasoning parts from all steps are collected into the merged message
 * - A user message marks the boundary between turns
 * - `info` notices (e.g. the abort bubble) are standalone system messages: they
 *   are never merged into assistant turn content, and they flush any pending
 *   text into its own message first so it doesn't fold into the notice.
 */
export function mergeAssistantMessagesForDisplay(messages: PersistedMessage[]): MergedMessage[] {
  const result: MergedMessage[] = [];
  let pendingTexts: string[] = [];
  let pendingIds: string[] = [];
  let pendingReasoningParts: ReasoningPart[] = [];
  let pendingSources: PersistedMessage[] = [];

  const resetPending = () => {
    pendingTexts = [];
    pendingIds = [];
    pendingReasoningParts = [];
    pendingSources = [];
  };

  const flushPending = () => {
    if (pendingTexts.length > 0 || pendingReasoningParts.length > 0) {
      result.push({
        id: `merged-${pendingIds.join('-')}`,
        role: 'assistant',
        content: pendingTexts.join('\n\n'),
        createdAt: new Date(),
        sourceMessages: pendingSources,
        ...(pendingReasoningParts.length > 0 ? { reasoningParts: pendingReasoningParts } : {}),
      });
    }
    // Reset unconditionally: a turn whose assistant messages only carried tool
    // calls fills `pendingSources` while leaving text and reasoning empty, and
    // those sources must not be handed to the next turn's merged message.
    resetPending();
  };

  for (const msg of messages) {
    if (msg.role === 'tool') {
      // Not rendered by the built-in bubble, but kept as a source so a custom
      // Message slot can read the result a tool call produced.
      pendingSources.push(msg);
      continue;
    }

    if (msg.displayMode === 'info') {
      // System notice — flush the in-progress assistant text as its own
      // message, then keep the notice standalone (no merge, no displayMode leak).
      flushPending();
      result.push({ ...msg, sourceMessages: [msg] });
      continue;
    }

    if (msg.role === 'assistant') {
      const text = getTextFromContent(msg.content);

      if (msg.toolCalls && msg.toolCalls.length > 0) {
        // Intermediate assistant with tool calls — accumulate text and reasoning, skip message
        pendingIds.push(msg.id);
        pendingSources.push(msg);
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
          sourceMessages: [...pendingSources, msg],
          ...(allReasoningParts && allReasoningParts.length > 0 ? { reasoningParts: allReasoningParts } : {}),
        });
        resetPending();
      }
    } else {
      // User message — flush any pending text and reset for next turn
      flushPending();
      result.push({ ...msg, sourceMessages: [msg] });
    }
  }

  // Handle trailing pending text (e.g., streaming step that hasn't finished)
  flushPending();

  return result;
}
