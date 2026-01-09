import type { FileUploadBackend } from './types';

/**
 * File upload backend that embeds files as base64 data URLs.
 *
 * This is the default backend for file uploads. It converts files
 * to base64 data URLs at send time, which are then embedded directly
 * in the message sent to the AI.
 *
 * Pros:
 * - No external storage required
 * - Simple setup
 *
 * Cons:
 * - Increases message size (base64 is ~33% larger than binary)
 * - Files are not persistent across sessions
 * - Not suitable for very large files
 *
 * @example
 * ```typescript
 * import { UseAIProvider, EmbedFileUploadBackend } from '@meetsmore/use-ai-client';
 *
 * <UseAIProvider
 *   serverUrl="wss://..."
 *   fileUploadConfig={{
 *     backend: new EmbedFileUploadBackend(),
 *     maxFileSize: 10 * 1024 * 1024, // 10MB
 *   }}
 * >
 *   <App />
 * </UseAIProvider>
 * ```
 */
export class EmbedFileUploadBackend implements FileUploadBackend {
  /**
   * Converts a File to a base64 data URL.
   *
   * @param file - The File object to convert
   * @returns Promise resolving to a base64 data URL (e.g., "data:image/png;base64,...")
   * @throws Error if file reading fails
   */
  async prepareForSend(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
        } else {
          reject(new Error('Failed to read file as data URL'));
        }
      };

      reader.onerror = () => {
        reject(new Error(`Failed to read file: ${file.name}`));
      };

      reader.readAsDataURL(file);
    });
  }
}
