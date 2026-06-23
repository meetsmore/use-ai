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
 * Result of preparing a file for sending.
 *
 * Exactly one variant is returned:
 * - `{ url }`: a directly-usable URL (base64 data URL for embed, or a remote URL).
 *   The bytes travel with the message. Legacy embed path.
 * - `{ ref }`: a persistent storage pointer (e.g. an S3 key). The bytes stay in
 *   storage; only the ref travels with the message and persists in history. The
 *   server resolves the ref to a short-lived signed URL just-in-time on each run.
 *
 * A backend may also return a bare `string`, which is treated as `{ url: string }`
 * for backward compatibility with backends written against the old signature.
 */
export type FileUploadResult = { url: string } | { ref: string };

/**
 * Abstract file upload backend interface.
 * Converts File objects to a sendable reference at send time.
 *
 * Implementations:
 * - EmbedFileUploadBackend: Converts to base64 data URL (built-in)
 * - A host S3 backend: uploads to storage and returns a persistent `ref`
 */
export interface FileUploadBackend {
  /**
   * Prepare file for sending to AI. Called at send time.
   *
   * @param file - The File object to prepare
   * @returns Either a {@link FileUploadResult} (`{ url }` or `{ ref }`) or, for
   *          backward compatibility, a bare URL string (treated as `{ url }`).
   */
  prepareForSend(file: File): Promise<string | FileUploadResult>;
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
 * Receives all files that were matched to this transformer instance
 * and returns one string per file in the same order.
 *
 * @example
 * ```typescript
 * const pdfTransformer: FileTransformer = {
 *   transform: async (files, context) =>
 *     Promise.all(files.map(f => extractText(f))),
 * };
 * ```
 */
export interface FileTransformer {
  /**
   * Transform files into string representations for the AI.
   *
   * @param files - The files to transform (all matched to this transformer instance)
   * @param context - Context including the current chat and its metadata
   * @param onProgress - Optional callback for reporting progress (0-100).
   *                     If called, UI shows progress bar; otherwise shows spinner.
   * @returns One string per input file, in the same order
   * @throws If transformation fails
   */
  transform(
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
  /**
   * Maximum number of attachments allowed per message.
   * Enforced at attach time — files beyond the limit are rejected with an error.
   * The value is a host policy (e.g. set below the AI provider's per-message cap);
   * use-ai only exposes the knob and does not assume a default. If undefined,
   * the number of attachments is not limited.
   */
  maxAttachments?: number;
}
