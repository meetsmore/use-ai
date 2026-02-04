import type { Chat } from '../providers/chatRepository/types';

/**
 * Default maximum file size (10MB)
 */
export const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Persisted file metadata (lightweight, for storage).
 * Only metadata is stored - not the actual file data.
 */
export interface PersistedFileMetadata {
  /** Original file name */
  name: string;
  /** File size in bytes */
  size: number;
  /** MIME type of the file */
  mimeType: string;
}

/**
 * Runtime file attachment (local File reference until send).
 * The File object is kept in memory until the message is sent,
 * at which point it's converted to a URL via the FileUploadBackend.
 */
export interface FileAttachment {
  /** Unique identifier for this attachment */
  id: string;
  /** The local File object */
  file: File;
  /** Data URL for image thumbnails (generated on attach for preview) */
  preview?: string;
  /**
   * Transformed content (if a transformer matched this file's MIME type).
   * Populated asynchronously after attachment - check processingState for status.
   */
  transformedContent?: string;
}

/**
 * Abstract file upload backend interface.
 * Converts File objects to URLs at send time.
 *
 * Implementations:
 * - EmbedFileUploadBackend: Converts to base64 data URL (built-in)
 * - S3FileUploadBackend: Uploads to S3 and returns public URL (future)
 */
export interface FileUploadBackend {
  /**
   * Prepare file for sending to AI.
   * Called at send time - converts File to URL.
   *
   * @param file - The File object to prepare
   * @returns Promise resolving to a URL string
   *          - For embed: base64 data URL
   *          - For S3: public URL after upload
   */
  prepareForSend(file: File): Promise<string>;
}

/**
 * Context provided to file transformers.
 */
export interface FileTransformerContext {
  /** The current chat (includes metadata) */
  chat: Chat | null;
}

/**
 * A transformer that converts files into string representations for the AI.
 *
 * ## Single vs Batch Processing
 *
 * By default, each file is processed individually via `transform()`.
 * For use cases where multiple files should be processed together
 * (e.g., multi-page OCR), implement `transformBatch()`.
 *
 * ### Processing Logic
 *
 * When multiple files are attached:
 * 1. If `transformBatch` is implemented:
 *    - Call `shouldBatch()` to determine if batch processing should be used
 *    - If `shouldBatch` returns true (or is undefined), use `transformBatch()`
 *    - If `shouldBatch` returns false, fall back to individual `transform()` calls
 * 2. If `transformBatch` is not implemented:
 *    - Process each file individually via `transform()`
 *
 * @example
 * ```typescript
 * // Simple transformer (single file only)
 * const pdfTransformer: FileTransformer = {
 *   transform: async (file, context) => extractText(file),
 * };
 *
 * // Batch-capable transformer with conditional batching
 * const ocrTransformer: FileTransformer = {
 *   transform: async (file, context) => singleOcr(file),
 *   shouldBatch: (context) => !!context.chat?.metadata?.targetType,
 *   transformBatch: async (files, context) => batchOcr(files),
 * };
 * ```
 */
export interface FileTransformer {
  /**
   * Transform a single file into a string representation for the AI.
   *
   * Called when:
   * - Only one file is attached, OR
   * - `transformBatch` is not implemented, OR
   * - `shouldBatch` returns false
   *
   * @param file - The file to transform
   * @param context - Context including the current chat and its metadata
   * @param onProgress - Optional callback for reporting progress (0-100).
   *                     If called, UI shows progress bar; otherwise shows spinner.
   * @returns A string representation the AI will receive
   * @throws If transformation fails
   */
  transform(
    file: File,
    context: FileTransformerContext,
    onProgress?: (progress: number) => void
  ): Promise<string>;

  /**
   * Determine whether to use batch processing for multiple files.
   *
   * Only called when `transformBatch` is implemented AND multiple files
   * match this transformer. Use this to conditionally enable batch processing
   * based on context (e.g., chat metadata).
   *
   * @param context - Context including the current chat and its metadata
   * @returns true to use batch processing, false to process individually
   * @default true (if undefined and transformBatch exists, batch processing is used)
   *
   * @example
   * ```typescript
   * // Only batch when chat has OCR metadata
   * shouldBatch: (context) => !!context.chat?.metadata?.targetType
   * ```
   */
  shouldBatch?(context: FileTransformerContext): boolean;

  /**
   * Transform multiple files together in a single batch operation.
   *
   * Called when:
   * 1. This method is implemented
   * 2. Multiple files match this transformer
   * 3. `shouldBatch()` returns true (or is undefined)
   *
   * Use this for operations where processing files together improves
   * accuracy or efficiency (e.g., multi-page document OCR).
   *
   * @param files - Array of files to transform together
   * @param context - Context including the current chat and its metadata
   * @param onProgress - Optional callback for reporting overall progress (0-100)
   * @returns Array of transformed strings, one per input file (same order)
   * @throws If transformation fails
   *
   * @example
   * ```typescript
   * transformBatch: async (files, context, onProgress) => {
   *   const results = await batchOcrApi(files, { onProgress });
   *   return results; // ['text1', 'text2', 'text3']
   * }
   * ```
   */
  transformBatch?(
    files: File[],
    context: FileTransformerContext,
    onProgress?: (progress: number) => void
  ): Promise<string[]>;
}

/**
 * Map of MIME type patterns to transformers.
 *
 * Keys are MIME type patterns:
 * - Exact match: 'application/pdf'
 * - Partial wildcard: 'image/*'
 * - Global wildcard: '*' or '*\/*'
 *
 * When multiple patterns match, the most specific one wins:
 * 1. Exact match (e.g., 'application/pdf')
 * 2. Partial wildcard (e.g., 'image/*')
 * 3. Global wildcard ('*' or '*\/*')
 */
export type FileTransformerMap = Record<string, FileTransformer>;

/**
 * Status of file processing during send.
 */
export type FileProcessingStatus = 'idle' | 'processing' | 'done' | 'error';

/**
 * Processing state for a file attachment.
 */
export interface FileProcessingState {
  status: FileProcessingStatus;
  /** Progress 0-100, or undefined for indeterminate (spinner) */
  progress?: number;
}

/**
 * Configuration for file uploads in UseAIProvider.
 */
export interface FileUploadConfig {
  /**
   * Backend for converting files to URLs at send time.
   * Defaults to EmbedFileUploadBackend if not specified.
   */
  backend?: FileUploadBackend;
  /**
   * Maximum file size in bytes.
   * @default 10485760 (10MB)
   */
  maxFileSize?: number;
  /**
   * Accepted MIME types.
   * Supports patterns like 'image/*' or specific types like 'application/pdf'.
   * If undefined, all types are accepted.
   */
  acceptedTypes?: string[];
  /**
   * Map of MIME type patterns to transformers.
   * Files matching a transformer pattern will be converted to text
   * before being sent to the AI.
   */
  transformers?: FileTransformerMap;
}
