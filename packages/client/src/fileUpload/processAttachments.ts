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
  /**
   * Called when batch processing starts/ends.
   * Use this to show batch-specific UI (e.g., "Processing 3 files...").
   */
  onBatchProgress?: (state: FileProcessingState & { fileCount?: number }) => void;
}

/**
 * In-memory cache for transformed file content.
 * Keyed by file identity (name + size + lastModified).
 */
const transformationCache = new Map<string, string>();

/**
 * Generate a cache key for a file based on its identity.
 */
function getFileCacheKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

/**
 * Get transformed content for a file, using cache if available.
 * @param file - The file to transform
 * @param transformer - The transformer to use
 * @param context - Context for the transformer (including current chat)
 * @param onProgress - Optional progress callback
 * @returns The transformed text content
 * @throws If transformation fails
 */
export async function getTransformedContent(
  file: File,
  transformer: FileTransformer,
  context: FileTransformerContext,
  onProgress?: (progress: number) => void
): Promise<string> {
  const cacheKey = getFileCacheKey(file);
  const cached = transformationCache.get(cacheKey);

  if (cached !== undefined) {
    return cached;
  }

  const result = await transformer.transform(file, context, onProgress);
  transformationCache.set(cacheKey, result);
  return result;
}

/**
 * Group attachments by their transformer.
 * Preserves original order within each group.
 */
function groupAttachmentsByTransformer(
  attachments: FileAttachment[],
  transformers: FileTransformerMap
): Map<FileTransformer | null, FileAttachment[]> {
  const groups = new Map<FileTransformer | null, FileAttachment[]>();

  for (const attachment of attachments) {
    // Pre-transformed files go to null group
    if (attachment.transformedContent !== undefined) {
      const existing = groups.get(null);
      if (existing) {
        existing.push(attachment);
      } else {
        groups.set(null, [attachment]);
      }
      continue;
    }

    const transformer = findTransformer(attachment.file.type, transformers);
    const key = transformer ?? null;
    const existing = groups.get(key);
    if (existing) {
      existing.push(attachment);
    } else {
      groups.set(key, [attachment]);
    }
  }

  return groups;
}

/**
 * Check if all files in the batch are already cached.
 */
function areAllFilesCached(files: File[]): boolean {
  return files.every((file) => transformationCache.has(getFileCacheKey(file)));
}

/**
 * Process a single attachment without transformer (URL encoding or pre-transformed).
 */
async function processAttachmentWithoutTransformer(
  attachment: FileAttachment,
  backend: FileUploadBackend
): Promise<MultimodalContent> {
  // Pre-transformed content - just wrap it
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

  // URL encoding
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
 * Get cached results for all files (assumes all are cached).
 */
function getCachedResults(files: File[]): string[] {
  return files.map((file) => transformationCache.get(getFileCacheKey(file))!);
}

/**
 * Process a group of attachments with batch processing if available.
 */
async function processTransformerGroup(
  transformer: FileTransformer,
  attachments: FileAttachment[],
  context: FileTransformerContext,
  onFileProgress?: (fileId: string, state: FileProcessingState) => void,
  onBatchProgress?: (state: FileProcessingState & { fileCount?: number }) => void
): Promise<MultimodalContent[]> {
  const files = attachments.map((a) => a.file);
  const contentParts: MultimodalContent[] = [];

  // Check if all files are already cached (skip batch processing entirely)
  if (areAllFilesCached(files)) {
    return getCachedResults(files).map((text, i) => ({
      type: 'transformed_file' as const,
      text,
      originalFile: {
        name: files[i].name,
        mimeType: files[i].type,
        size: files[i].size,
      },
    }));
  }

  // Check if batch processing should be used
  const canBatch =
    transformer.transformBatch !== undefined && files.length > 1;
  const shouldBatch = canBatch
    ? (transformer.shouldBatch?.(context) ?? true)
    : false;

  if (shouldBatch && transformer.transformBatch) {
    // Batch processing
    onBatchProgress?.({ status: 'processing', fileCount: files.length });

    // Mark all files as processing
    for (const attachment of attachments) {
      onFileProgress?.(attachment.id, { status: 'processing' });
    }

    try {
      const results = await transformer.transformBatch(
        files,
        context,
        (progress) => {
          onBatchProgress?.({
            status: 'processing',
            progress,
            fileCount: files.length,
          });
        }
      );

      // Validate result length
      if (results.length !== files.length) {
        throw new Error(
          `transformBatch returned ${results.length} results for ${files.length} files`
        );
      }

      // Cache results and build content parts
      // Note: Cache is populated only after all results are received to ensure consistency
      for (let i = 0; i < results.length; i++) {
        const file = files[i];
        const attachment = attachments[i];
        const text = results[i];

        // Cache the result
        transformationCache.set(getFileCacheKey(file), text);

        contentParts.push({
          type: 'transformed_file',
          text,
          originalFile: {
            name: file.name,
            mimeType: file.type,
            size: file.size,
          },
        });

        onFileProgress?.(attachment.id, { status: 'done' });
      }

      onBatchProgress?.({ status: 'done', fileCount: files.length });
    } catch (error) {
      // Mark all files as error
      for (const attachment of attachments) {
        onFileProgress?.(attachment.id, { status: 'error' });
      }
      onBatchProgress?.({ status: 'error', fileCount: files.length });
      throw error;
    }
  } else {
    // Individual processing (original behavior)
    for (const attachment of attachments) {
      onFileProgress?.(attachment.id, { status: 'processing' });

      try {
        const transformedText = await getTransformedContent(
          attachment.file,
          transformer,
          context,
          (progress) => {
            onFileProgress?.(attachment.id, { status: 'processing', progress });
          }
        );

        contentParts.push({
          type: 'transformed_file',
          text: transformedText,
          originalFile: {
            name: attachment.file.name,
            mimeType: attachment.file.type,
            size: attachment.file.size,
          },
        });

        onFileProgress?.(attachment.id, { status: 'done' });
      } catch (error) {
        onFileProgress?.(attachment.id, { status: 'error' });
        throw error;
      }
    }
  }

  return contentParts;
}

/**
 * Process file attachments into multimodal content for AI.
 * Handles transformation (with caching) or URL encoding.
 *
 * ## Batch Processing
 *
 * When multiple files match a transformer that implements `transformBatch`,
 * they are processed together in a single batch operation. This is useful
 * for operations like multi-page OCR where processing files together
 * improves accuracy.
 *
 * The transformer can control batch behavior via `shouldBatch()`:
 * - If `shouldBatch` returns true (or is undefined), batch processing is used
 * - If `shouldBatch` returns false, files are processed individually
 *
 * ## Output Order
 *
 * **Note:** Output order may differ from input order when batch processing is used.
 * Files are grouped by transformer, so `[pdf1, image1, pdf2, image2]` may produce
 * `[pdf1, pdf2, image1, image2]`. Order within each group is preserved.
 * Use `originalFile.name` to identify files if order matters.
 *
 * @param attachments - The file attachments to process
 * @param config - Processing configuration
 * @returns Array of multimodal content parts (order may differ from input when batching)
 * @throws On any processing error - caller should handle and show to user
 *
 * @example
 * ```typescript
 * const content = await processAttachments(attachments, {
 *   transformers: { 'application/pdf': pdfTransformer },
 *   onFileProgress: (id, state) => setProgress(prev => new Map(prev).set(id, state)),
 *   onBatchProgress: (state) => setBatchState(state),
 * });
 * ```
 */
export async function processAttachments(
  attachments: FileAttachment[],
  config: ProcessAttachmentsConfig
): Promise<MultimodalContent[]> {
  const {
    getCurrentChat,
    backend = new EmbedFileUploadBackend(),
    transformers = {},
    onFileProgress,
    onBatchProgress,
  } = config;

  // Get current chat once for all transformers
  const chat = await getCurrentChat();
  const context: FileTransformerContext = { chat };

  // Group attachments by transformer for potential batch processing
  const groups = groupAttachmentsByTransformer(attachments, transformers);

  const contentParts: MultimodalContent[] = [];

  // Process each group
  for (const [transformer, groupAttachments] of groups) {
    // No transformer - handle pre-transformed and URL encoding
    if (transformer === null) {
      for (const attachment of groupAttachments) {
        const part = await processAttachmentWithoutTransformer(
          attachment,
          backend
        );
        contentParts.push(part);
      }
      continue;
    }

    // Process with transformer (potentially as batch)
    const transformedParts = await processTransformerGroup(
      transformer,
      groupAttachments,
      context,
      onFileProgress,
      onBatchProgress
    );
    contentParts.push(...transformedParts);
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
