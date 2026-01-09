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
}
