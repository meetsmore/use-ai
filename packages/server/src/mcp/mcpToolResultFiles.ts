/**
 * Files (images and PDFs) returned in a remote MCP tool result.
 *
 * MCP tools can return `image` content parts and embedded `resource` parts with a base64
 * `blob`. These are handed to the model as part of the tool result, and stay in the
 * model input for the rest of that run. The files are kept under a symbol key, so
 * `JSON.stringify` of the tool output (AI SDK telemetry spans, logs) leaves the file data
 * out. The TOOL_CALL_RESULT event the client stores as history carries a short note in
 * place of each file, so the history does not grow by the size of the file. To read the
 * file again on a later turn, the model calls the tool again.
 *
 * @see https://modelcontextprotocol.io/specification/2025-06-18/server/tools#tool-result
 */

/**
 * Key under which the files are attached to a tool result object. A symbol, so that
 * serializing the output for telemetry or logs does not copy the file data.
 */
export const USE_AI_FILES = Symbol.for('use-ai.toolResultFiles');

/** Key under which the notes replacing the files appear in the history. */
export const USE_AI_FILES_NOTE_KEY = '_use_ai_files';

/** A file taken from an MCP tool result, to be shown to the model. */
export interface ToolResultFile {
  /** IANA media type, e.g. `image/png` or `application/pdf`. */
  mediaType: string;
  /** Base64-encoded file data. */
  data: string;
  /** File name, when the MCP resource URI carries one. */
  filename?: string;
}

/** What is kept in place of a file outside the model call. */
export interface OmittedToolResultFile {
  mediaType: string;
  filename?: string;
  note: string;
}

/** MCP content part, as far as this module reads it. */
export interface McpContentPart {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
  resource?: { uri?: string; mimeType?: string; blob?: string; text?: string };
}

/**
 * Tool result output for the model, in the AI SDK `ToolResultOutput` shape.
 * Declared here so the module does not depend on a specific AI SDK version's type export.
 */
export type ModelToolResultOutput =
  | { type: 'text'; value: string }
  | { type: 'json'; value: unknown }
  | {
      type: 'content';
      value: Array<
        | { type: 'text'; text: string }
        | { type: 'image-data'; data: string; mediaType: string }
        | { type: 'file-data'; data: string; mediaType: string; filename?: string }
        | { type: 'media'; data: string; mediaType: string }
      >;
    };

const OMITTED_NOTE =
  'The file content was given to the model for this tool call only and is not kept in the conversation history. Call the tool again to read it.';

/** Only media types the model providers accept as tool result content are passed on. */
function isSupportedMediaType(mediaType: string | undefined): mediaType is string {
  return !!mediaType && (mediaType.startsWith('image/') || mediaType === 'application/pdf');
}

function filenameFromUri(uri: string | undefined): string | undefined {
  if (!uri) return undefined;
  const last = uri.split(/[/\\]/).pop();
  if (!last) return undefined;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/**
 * Collects image and PDF parts from an MCP tool result's content.
 * Parts with other media types, and resources without a `blob`, are left out.
 */
export function extractFilesFromMcpContent(content: McpContentPart[]): ToolResultFile[] {
  const files: ToolResultFile[] = [];
  for (const part of content) {
    if (part.type === 'image' && part.data && isSupportedMediaType(part.mimeType)) {
      files.push({ mediaType: part.mimeType, data: part.data });
    } else if (
      part.type === 'resource' &&
      part.resource?.blob &&
      isSupportedMediaType(part.resource.mimeType)
    ) {
      const filename = filenameFromUri(part.resource.uri);
      files.push({
        mediaType: part.resource.mimeType,
        data: part.resource.blob,
        ...(filename ? { filename } : {}),
      });
    }
  }
  return files;
}

/** Whether a tool result carries files for the model. */
export function hasToolResultFiles(
  output: unknown
): output is Record<string, unknown> & { [USE_AI_FILES]: ToolResultFile[] } {
  return (
    typeof output === 'object' &&
    output !== null &&
    Array.isArray((output as Record<PropertyKey, unknown>)[USE_AI_FILES])
  );
}

/** How file parts are written in the tool result the model sees. */
export interface ToolResultFilePartOptions {
  /**
   * Write each file as `{ type: 'media', data, mediaType }` instead of `image-data` /
   * `file-data`. The Vercel AI Gateway, which resolves gateway model ID strings, accepts
   * only `text` and `media` (or `image`) parts in tool result content and rejects the
   * other part types with 400 `invalid_union`. Provider packages called directly (such
   * as `@ai-sdk/anthropic`) read `image-data` / `file-data`.
   */
  mediaParts?: boolean;
}

/**
 * Builds the tool result the model sees.
 * Without files this is the same output the AI SDK builds when a tool has no
 * `toModelOutput`: text for a string, JSON otherwise.
 */
export function toModelOutputWithFiles(
  output: unknown,
  options: ToolResultFilePartOptions = {}
): ModelToolResultOutput {
  if (!hasToolResultFiles(output)) {
    return typeof output === 'string'
      ? { type: 'text', value: output }
      : { type: 'json', value: output === undefined ? null : output };
  }

  const { [USE_AI_FILES]: files, ...rest } = output;
  return {
    type: 'content',
    value: [
      { type: 'text', text: JSON.stringify(rest) },
      ...files.map(file =>
        options.mediaParts
          ? { type: 'media' as const, data: file.data, mediaType: file.mediaType }
          : file.mediaType.startsWith('image/')
          ? { type: 'image-data' as const, data: file.data, mediaType: file.mediaType }
          : {
              type: 'file-data' as const,
              data: file.data,
              mediaType: file.mediaType,
              ...(file.filename ? { filename: file.filename } : {}),
            }
      ),
    ],
  };
}

/**
 * Replaces the files with short notes, for the TOOL_CALL_RESULT event the client keeps
 * as history. Outputs without files are returned as-is.
 */
export function omitToolResultFiles(output: unknown): unknown {
  if (!hasToolResultFiles(output)) return output;
  const { [USE_AI_FILES]: files, ...rest } = output;
  const omitted: OmittedToolResultFile[] = files.map(file => ({
    mediaType: file.mediaType,
    ...(file.filename ? { filename: file.filename } : {}),
    note: OMITTED_NOTE,
  }));
  return { ...rest, [USE_AI_FILES_NOTE_KEY]: omitted };
}
