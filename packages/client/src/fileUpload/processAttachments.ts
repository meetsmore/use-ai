import type { MultimodalContent } from '@meetsmore-oss/use-ai-core';
import type {
  FileAttachment,
  FileUploadBackend,
  FileTransformerMap,
  FileTransformer,
  FileTransformerContext,
  FileProcessingState,
} from './types';
import type { Chat } from '../providers/chatRepository/types';
import { findTransformer } from './mimeTypeMatcher';
import { EmbedFileUploadBackend } from './EmbedFileUploadBackend';

/**
 * Configuration for processing file attachments.
 */
export interface ProcessAttachmentsConfig {
  /** Function to get the current chat (for transformer context) */
  getCurrentChat: () => Promise<Chat | null>;
  /** Backend for converting files to URLs (default: EmbedFileUploadBackend) */
  backend?: FileUploadBackend;
  /** Map of MIME type patterns to transformers */
  transformers?: FileTransformerMap;
  /** Called when a file's processing state changes */
  onFileProgress?: (fileId: string, state: FileProcessingState) => void;
}

/**
 * In-memory cache for transformed file content.
 * Keyed by the combined identity of the file group.
 */
const transformationCache = new Map<string, string[]>();

/**
 * Generate a cache key for a file based on its identity.
 */
function getFileCacheKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

/**
 * Get transformed content for files, using cache when possible.
 * Results are cached per group (same set of files in the same order = cache hit).
 */
export async function getTransformedContent(
  files: File[],
  transformer: FileTransformer,
  context: FileTransformerContext,
  onProgress?: (progress: number) => void
): Promise<string[]> {
  if (files.length === 0) {
    return [];
  }

  const cacheKey = files.map(getFileCacheKey).join('|');
  const cached = transformationCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const results = await transformer.transform(files, context, onProgress);

  transformationCache.set(cacheKey, results);

  return results;
}

/**
 * Convert a single attachment (without transformer) to a content part.
 */
async function toContentPart(
  attachment: FileAttachment,
  backend: FileUploadBackend
): Promise<MultimodalContent> {
  if (attachment.transformedContent !== undefined) {
    return {
      type: 'transformed_file',
      text: attachment.transformedContent,
      originalFile: {
        name: attachment.file.name,
        mimeType: attachment.file.type,
        size: attachment.file.size,
      },
    };
  }

  const url = await backend.prepareForSend(attachment.file);

  if (attachment.file.type.startsWith('image/')) {
    return { type: 'image', url };
  }

  return {
    type: 'file',
    url,
    mimeType: attachment.file.type,
    name: attachment.file.name,
  };
}

/**
 * Process file attachments into multimodal content for AI.
 * Handles transformation (with caching) or URL encoding.
 *
 * Files matching the same transformer are grouped and passed together
 * to `transformer.transform()`.
 *
 * @param attachments - The file attachments to process
 * @param config - Processing configuration
 * @returns Array of multimodal content parts
 * @throws On any processing error - caller should handle and show to user
 *
 * @example
 * ```typescript
 * const content = await processAttachments(attachments, {
 *   transformers: { 'application/pdf': pdfTransformer },
 *   onFileProgress: (id, state) => setProgress(prev => new Map(prev).set(id, state)),
 * });
 * ```
 */
export async function processAttachments(
  attachments: FileAttachment[],
  config: ProcessAttachmentsConfig
): Promise<MultimodalContent[]> {
  const { getCurrentChat, backend = new EmbedFileUploadBackend(), transformers = {}, onFileProgress } = config;
  const contentParts: MultimodalContent[] = [];

  // Get current chat once for all transformers
  const chat = await getCurrentChat();
  const context: FileTransformerContext = { chat };

  // Group attachments by transformer pattern key (null = no transformer)
  const groups = Map.groupBy(attachments, (attachment) =>
    attachment.transformedContent !== undefined
      ? null
      : findTransformer(attachment.file.type, transformers) ?? null
  );

  for (const [key, groupAttachments] of groups) {
    // No transformer matched — convert directly (fast, no progress needed)
    if (key === null) {
      const parts = await Promise.all(
        groupAttachments.map((a) => toContentPart(a, backend))
      );
      contentParts.push(...parts);
      continue;
    }

    // Run the matching transformer for this group
    const transformer = transformers[key];
    const files = groupAttachments.map((a) => a.file);
    groupAttachments.forEach((a) => onFileProgress?.(a.id, { status: 'processing' }));

    try {
      const results = await getTransformedContent(
        files,
        transformer,
        context,
        (progress) => {
          groupAttachments.forEach((a) => onFileProgress?.(a.id, { status: 'processing', progress }));
        }
      );

      results.forEach((text, i) => {
        contentParts.push({
          type: 'transformed_file',
          text,
          originalFile: {
            name: files[i].name,
            mimeType: files[i].type,
            size: files[i].size,
          },
        });
        onFileProgress?.(groupAttachments[i].id, { status: 'done' });
      });
    } catch (error) {
      groupAttachments.forEach((a) => onFileProgress?.(a.id, { status: 'error' }));
      throw error;
    }
  }

  return contentParts;
}

/**
 * Clear the transformation cache.
 * Useful for testing or when memory needs to be freed.
 */
export function clearTransformationCache(): void {
  transformationCache.clear();
}
