/**
 * Splits a base64 data url (`data:<mediaType>;base64,<data>`) into its media type and base64 content.
 * Returns undefined for anything else, including data urls that are not base64.
 *
 * The AI SDK downloads every url part that the model does not take as a url, and its downloader
 * only accepts http and https, so a data url passed as a url fails the run. Passing the base64
 * content with the media type keeps inline attachments working.
 */
export function splitBase64DataUrl(url: string): { mediaType: string; data: string } | undefined {
  const match = /^data:([^;,]+)((?:;[^;,]+)*);base64,(.*)$/s.exec(url);
  if (!match) return undefined;
  return { mediaType: match[1], data: match[3] };
}
