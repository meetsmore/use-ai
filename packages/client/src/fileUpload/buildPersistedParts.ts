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
 * Attachments that carry a ref (uploaded to storage by a backend that returns
 * a ref) are persisted as `stored_file`; carrying the ref lets them be re-sent
 * after a reload. Attachments whose part is url-bearing (inline base64 embed)
 * have no ref, so they are persisted as metadata-only `file`.
 *
 * Non-transformed attachments map one-to-one with content parts by position and
 * follow the order of `attachments`. Each attachment reads the ref from its own
 * part, so ref and url parts never get mixed up. Whether a stored_file restores
 * later as image or file is decided by the attachment's own mimeType, not the part.
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
  // Hold non-transformed content parts (image/file, carrying ref or url) in attachment order; consumed one per non-transformed attachment below.
  const nonTransformedParts: MultimodalContent[] = [];

  for (const part of fileContent) {
    if (part.type === 'transformed_file') {
      const key = `${part.originalFile.name}:${part.originalFile.size}:${part.originalFile.mimeType}`;
      const list = transformedByKey.get(key);
      if (list) {
        list.push(part);
      } else {
        transformedByKey.set(key, [part]);
      }
    } else {
      nonTransformedParts.push(part);
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
      continue;
    }

    const part = nonTransformedParts.shift();

    const ref = part && (part.type === 'image' || part.type === 'file') ? part.ref : undefined;
    if (ref) {
      // Has ref: persist enough to show a placeholder and re-send via ref.
      parts.push({
        type: 'stored_file',
        ref,
        name: attachment.file.name,
        mimeType: attachment.file.type,
        size: attachment.file.size,
      });
    } else {
      // url-bearing / unresolvable — metadata only, discarded on reload.
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
