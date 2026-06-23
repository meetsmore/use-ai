import type { MultimodalContent } from '@meetsmore-oss/use-ai-core';
import type {
  FileAttachment,
  FileUploadBackend,
  FileUploadResult,
  FileTransformerMap,
  FileTransformer,
  FileTransformerContext,
  FileProcessingState,
} from './types';
import type { Chat } from '../providers/chatRepository/types';
import { findTransformerPattern } from './mimeTypeMatcher';
import { EmbedFileUploadBackend } from './EmbedFileUploadBackend';

/**
 * Group items by a key derived from each item.
 * Based on the Map.groupBy proposal polyfill.
 */
function groupBy<K, V>(items: Iterable<V>, keyFn: (item: V) => K): Map<K, V[]> {
  const map = new Map<K, V[]>();
  for (const item of items) {
    const key = keyFn(item);
    const list = map.get(key);
    list ? list.push(item) : map.set(key, [item]);
  }
  return map;
}

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
 * Keyed by a SHA-256 hash of the file group identity.
 */
const transformationCache = new Map<string, string[]>();

/**
 * Generate a cache key fragment for a single file based on its identity.
 */
function getFileCacheKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

/**
 * Hash a group of files into a fixed-length cache key.
 * Each file is identified by name, size, and lastModified, then the
 * combined string is hashed with SHA-256 to keep key size constant
 * regardless of how many files are in the group.
 *
 * Order matters: [A, B] and [B, A] produce different cache keys because
 * transformer results are positional (results[i] corresponds to files[i]).
 *
 * @example
 * // Input:  ["report.pdf:1024:1700000000", "scan.pdf:2048:1700000001"]
 * // Hashed: "a3f1...b7c2" (64-char hex string)
 */
async function hashGroupCacheKey(files: File[]): Promise<string> {
  const raw = files.map(getFileCacheKey).join(', ');
  const data = new TextEncoder().encode(raw);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Get transformed content for files, using cache when possible.
 * Results are cached per group (same set of files in the same order = cache hit).
 *
 * @param files - The files to transform (must all belong to the same transformer)
 * @param transformer - The transformer to use
 * @param context - Context for the transformer (including current chat)
 * @param onProgress - Optional progress callback (0-100)
 * @returns Transformer results (one or more strings, depending on the transformer)
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

  const cacheKey = await hashGroupCacheKey(files);
  const cached = transformationCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const results = await transformer.transform(files, context, onProgress);

  transformationCache.set(cacheKey, results);

  return results;
}

/**
 * Normalize a backend result into a {@link FileUploadResult}.
 *
 * A bare string is treated as `{ url }` for backward compatibility; a structured
 * result (`{ url }` or `{ ref }`) is passed through. The `FileUploadResult` union
 * already constrains the shape at compile time, so no runtime validation is needed.
 */
function normalizeUploadResult(result: string | FileUploadResult): FileUploadResult {
  return typeof result === 'string' ? { url: result } : result;
}

/**
 * Convert a single attachment to a multimodal content part.
 *
 * Backends that return a `ref` produce ref-bearing wire parts (the bytes stay in
 * storage); backends that return a `url` produce legacy url-bearing parts.
 */
async function toContentPart(
  attachment: FileAttachment,
  backend: FileUploadBackend
): Promise<MultimodalContent> {
  // Pre-transformed content (transformation at attach time)
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

  // No transformer — prepare via the backend (fast, no progress needed)
  const result = normalizeUploadResult(await backend.prepareForSend(attachment.file));
  const isImage = attachment.file.type.startsWith('image/');

  if ('ref' in result) {
    return isImage
      ? { type: 'image', ref: result.ref }
      : { type: 'file', ref: result.ref, mimeType: attachment.file.type, name: attachment.file.name };
  }

  return isImage
    ? { type: 'image', url: result.url }
    : { type: 'file', url: result.url, mimeType: attachment.file.type, name: attachment.file.name };
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
  const groups = groupBy(attachments, (attachment) =>
    attachment.transformedContent !== undefined
      ? null
      : findTransformerPattern(attachment.file.type, transformers) ?? null
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

      // Build content parts from transformer results and notify completion
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
