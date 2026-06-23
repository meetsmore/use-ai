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
 * Ref-bearing attachments (uploaded to storage via a backend that returns a `ref`)
 * are persisted as `stored_file`, carrying the ref so the attachment can be re-sent
 * after a reload. Attachments with a url-bearing part (legacy embed/base64) have no
 * ref and are persisted as metadata-only `file`, preserving pre-fix behavior.
 *
 * Non-transformed attachments are paired with their content part positionally:
 * `processAttachments` emits one image/file part per non-transformed attachment, in
 * attachment order (every such part flows through one order-preserving group), and
 * those attachments are visited here in the same order. Each attachment then reads
 * the `ref` off its own part (so a mix of ref- and url-bearing parts cannot steal
 * each other's ref). The attachment's own mimeType — not the part — decides
 * image-vs-file when the stored_file is later restored.
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
  // Non-transformed content parts (image/file, ref- or url-bearing) in attachment
  // order, consumed one per non-transformed attachment below.
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
      // Ref-backed: persist enough to display a placeholder and to re-send by ref.
      parts.push({
        type: 'stored_file',
        ref,
        name: attachment.file.name,
        mimeType: attachment.file.type,
        size: attachment.file.size,
      });
    } else {
      // Legacy url-bearing / unresolvable — metadata only, dropped on reload.
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
