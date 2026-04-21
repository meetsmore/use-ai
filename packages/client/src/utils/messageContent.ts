import type { PersistedMessageContent } from '../providers/chatRepository/types';

/**
 * Extracts text content from persisted message content for LLM / storage
 * round-trips. Includes the transformed text of `transformed_file` parts so
 * the full context survives a reload — use this when the output is fed back
 * to the model or written to storage.
 */
export function getTextFromContent(content: PersistedMessageContent): string {
  if (typeof content === 'string') {
    return content;
  }
  return content
    .flatMap((part) => {
      if (part.type === 'text') return [part.text];
      if (part.type === 'transformed_file') return [part.text];
      return [];
    })
    .join('\n');
}

/**
 * Extracts text content for UI display (chat bubble, chat title, save-as-
 * command preview). Intentionally omits `transformed_file` text so a large
 * OCR body does not leak into the user-facing message bubble or title.
 */
export function getDisplayTextFromContent(content: PersistedMessageContent): string {
  if (typeof content === 'string') {
    return content;
  }
  return content
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('\n');
}
