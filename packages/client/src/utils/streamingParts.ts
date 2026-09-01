import type { ChatStreamingPart } from '../hooks/useServerEvents';
import type { ReasoningPart } from '../types';

/**
 * Flattening the ordered parts of an in-flight run into what one bubble shows.
 * This is display-only: the run itself is kept as parts, and persisted as the
 * per-step messages `mergeAssistantMessagesForDisplay` merges.
 *
 * Both helpers join with a blank line and skip empty steps because that is what
 * the merge does (`pendingTexts` only collects steps that produced text, joined
 * with '\n\n'). A bubble built from parts and the same bubble built from the
 * persisted message must produce an identical string: the two render one after
 * the other into the same element, and a difference remounts it, dropping any
 * selection the user was making.
 */
export function getTextFromStreamingParts(parts: ChatStreamingPart[]): string {
  return parts
    .flatMap((part) => (part.kind === 'text' && part.text ? [part.text] : []))
    .join('\n\n');
}

/** The reasoning so far, in the shape a persisted turn carries it. */
export function getReasoningPartsFromStreamingParts(parts: ChatStreamingPart[]): ReasoningPart[] {
  return parts.flatMap((part) =>
    part.kind === 'reasoning' && part.text ? [{ text: part.text }] : [],
  );
}
