import type { PersistedContentPart, PersistedMessageContent } from '../../providers/chatRepository/types';

/**
 * Helper that checks whether `content` includes a file attachment. Covers both
 * the metadata-only `file` and the ref-based `attachment_ref`; both are rendered as
 * a name/size FilePlaceholder.
 */
export function hasFileContent(content: PersistedMessageContent): content is PersistedContentPart[] {
  return (
    Array.isArray(content) &&
    content.some(part => part.type === 'file' || part.type === 'attachment_ref')
  );
}

/** Extracts name + size from a file-bearing persisted part for the FilePlaceholder shown on reload. */
export function fileChipInfo(part: PersistedContentPart): { name: string; size: number } | null {
  if (part.type === 'file') {
    return { name: part.file.name, size: part.file.size };
  }
  if (part.type === 'attachment_ref') {
    return { name: part.name, size: part.size };
  }
  return null;
}
