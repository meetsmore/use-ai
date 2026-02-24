import type { PersistedMessageContent } from '../providers/chatRepository/types';

/**
 * Extracts text content from persisted message content.
 * Handles both simple string content and multimodal content arrays.
 */
export function getTextFromContent(content: PersistedMessageContent): string {
  if (typeof content === 'string') {
    return content;
  }
  return content
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map(part => part.text)
    .join('\n');
}
