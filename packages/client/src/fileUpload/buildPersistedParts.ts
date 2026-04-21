import type { MultimodalContent } from '@meetsmore-oss/use-ai-core';
import type { PersistedContentPart } from '../providers/chatRepository/types';
import type { FileAttachment } from './types';

type TransformedPart = Extract<MultimodalContent, { type: 'transformed_file' }>;

/**
 * Build the persisted content parts for a user message that includes file
 * attachments. The transformed text produced by `processAttachments` is
 * preserved alongside the attachment metadata so the content survives a
 * localStorage rehydration.
 *
 * Matching is done by `name:size:mimeType` plus positional consumption —
 * duplicate attachments with identical metadata still each get their own
 * transformed text (the N-th match resolves to the N-th transformed part).
 * Output order follows `attachments`, not `fileContent`, so the persisted
 * order matches what the user attached.
 *
 * Attachments without a transformed_file counterpart (pure image / file URL
 * parts) are persisted as metadata-only, preserving pre-fix behavior.
 */
export function buildPersistedParts(
  message: string,
  attachments: FileAttachment[],
  fileContent: MultimodalContent[]
): PersistedContentPart[] {
  const parts: PersistedContentPart[] = [];
  if (message.trim()) {
    parts.push({ type: 'text', text: message });
  }

  const transformedByKey = new Map<string, TransformedPart[]>();
  for (const part of fileContent) {
    if (part.type === 'transformed_file') {
      const key = `${part.originalFile.name}:${part.originalFile.size}:${part.originalFile.mimeType}`;
      const list = transformedByKey.get(key);
      if (list) {
        list.push(part);
      } else {
        transformedByKey.set(key, [part]);
      }
    }
  }

  for (const attachment of attachments) {
    const key = `${attachment.file.name}:${attachment.file.size}:${attachment.file.type}`;
    const transformed = transformedByKey.get(key)?.shift();
    if (transformed) {
      parts.push({
        type: 'transformed_file',
        text: transformed.text,
        originalFile: transformed.originalFile,
      });
    } else {
      parts.push({
        type: 'file',
        file: {
          name: attachment.file.name,
          size: attachment.file.size,
          mimeType: attachment.file.type,
        },
      });
    }
  }

  return parts;
}
