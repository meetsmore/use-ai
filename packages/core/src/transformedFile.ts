import type { TransformedFileContent } from './types';

/**
 * The fields of a `transformed_file` part that {@link transformedFileToText} reads.
 */
export type TransformedFileTextInput = Pick<TransformedFileContent, 'text'> & {
  originalFile: Pick<TransformedFileContent['originalFile'], 'name' | 'mimeType'>;
};

/**
 * Converts a `transformed_file` part to the text that the model sees.
 * The server and the client use this function, so both send the same text for one file.
 *
 * @example
 * transformedFileToText({ text: 'hello', originalFile: { name: 'a.txt', mimeType: 'text/plain' } });
 * // '[Content of file "a.txt" (text/plain)]:\n\nhello'
 */
export function transformedFileToText(part: TransformedFileTextInput): string {
  return `[Content of file "${part.originalFile.name}" (${part.originalFile.mimeType})]:\n\n${part.text}`;
}
