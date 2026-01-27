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
 * Process file attachments into multimodal content for AI.
 * Handles transformation (with caching) or URL encoding.
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

  for (const attachment of attachments) {
    onFileProgress?.(attachment.id, { status: 'processing' });

    try {
      // Check for pre-transformed content first (transformation at attach time)
      if (attachment.transformedContent !== undefined) {
        contentParts.push({
          type: 'transformed_file',
          text: attachment.transformedContent,
          originalFile: {
            name: attachment.file.name,
            mimeType: attachment.file.type,
            size: attachment.file.size,
          },
        });
        onFileProgress?.(attachment.id, { status: 'done' });
        continue;
      }

      // Look for a transformer to apply at send time
      const transformer = findTransformer(attachment.file.type, transformers);

      if (transformer) {
        // Transform file - let errors propagate
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
      } else {
        // No transformer - use URL encoding
        const url = await backend.prepareForSend(attachment.file);
        if (attachment.file.type.startsWith('image/')) {
          contentParts.push({ type: 'image', url });
        } else {
          contentParts.push({
            type: 'file',
            url,
            mimeType: attachment.file.type,
            name: attachment.file.name,
          });
        }
      }

      onFileProgress?.(attachment.id, { status: 'done' });
    } catch (error) {
      onFileProgress?.(attachment.id, { status: 'error' });
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
