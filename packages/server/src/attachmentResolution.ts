import type {
  Message,
  MultimodalContent,
  ResolveAttachments,
  ResolveAttachmentsContext,
} from '@meetsmore-oss/use-ai-core';

/**
 * Whether `part` is an attachment wire part carrying a `ref`: an `image_ref` /
 * `file_ref` part with a non-empty `ref` string, awaiting resolution.
 */
function hasRef(part: unknown): part is MultimodalContent {
  if (typeof part !== 'object' || part === null) {
    return false;
  }
  const p = part as { type?: unknown; ref?: unknown };
  return (
    (p.type === 'image_ref' || p.type === 'file_ref') &&
    typeof p.ref === 'string' &&
    p.ref.length > 0
  );
}

/**
 * Counts the `image_ref` / `file_ref` parts left in the history, for observability.
 * After resolution these become `image_url` / `file_url`; any that remain were not
 * resolved and are dropped during conversion (the attachment never reaches the model).
 */
export function countRefParts(messages: Message[]): number {
  let count = 0;
  for (const msg of messages) {
    const content = (msg as { content?: unknown }).content;
    if (Array.isArray(content)) {
      for (const part of content) {
        if (hasRef(part)) count++;
      }
    }
  }
  return count;
}

/**
 * Whether the AI SDK would fetch `url` on this server instead of using it inline.
 * Mirrors the SDK's own check: a string that parses as a URL is downloaded unless
 * it is a `data:` URL; a string that does not parse is treated as base64.
 */
function isFetchedUrl(url: unknown): boolean {
  if (typeof url !== 'string') return true;
  return URL.canParse(url) && new URL(url).protocol !== 'data:';
}

function isFetchedUrlPart(part: unknown): boolean {
  if (typeof part !== 'object' || part === null) return false;
  const p = part as { type?: unknown; url?: unknown };
  return (p.type === 'image_url' || p.type === 'file_url') && isFetchedUrl(p.url);
}

/**
 * Removes client-supplied `image_url` / `file_url` parts whose url the AI SDK would
 * download on this server (http(s), file:, ...), which would otherwise let a client
 * make the server fetch internal or local resources (SSRF). Inline `data:` urls
 * and raw base64 are kept.
 *
 * Must run before {@link resolveAttachmentParts}: urls returned by the host's
 * resolver are trusted and must not be filtered.
 *
 * Returns the original `messages` reference when nothing is removed.
 */
export function dropRemoteUrlParts(messages: Message[]): { messages: Message[]; dropped: number } {
  let dropped = 0;
  const out = messages.map((msg) => {
    const content = (msg as { content?: unknown }).content;
    if (!Array.isArray(content) || !content.some(isFetchedUrlPart)) {
      return msg;
    }
    const kept = content.filter((part) => !isFetchedUrlPart(part));
    dropped += content.length - kept.length;
    return { ...msg, content: kept } as Message;
  });
  return { messages: dropped > 0 ? out : messages, dropped };
}

/**
 * Collects ref-bearing attachment parts across the run's whole message history,
 * calls the host's `resolve` once, and puts the returned parts back in place.
 * The input is not mutated. See core's {@link ResolveAttachments} for the
 * details of the resolve contract.
 *
 * Returns the original `messages` reference as-is when there are no refs. When
 * there are, it returns a new array but clones only the messages and content
 * arrays it actually touches, so the caller's input is left unchanged.
 *
 * @throws When `resolve` returns a different number of parts than it was given
 *   (a contract violation; the host must return one replacement per input).
 */
export async function resolveAttachmentParts(
  messages: Message[],
  resolve: ResolveAttachments,
  context: ResolveAttachmentsContext,
): Promise<Message[]> {
  const refParts: MultimodalContent[] = [];
  const locations: Array<{ message: number; part: number }> = [];

  messages.forEach((msg, message) => {
    const content = (msg as { content?: unknown }).content;
    if (Array.isArray(content)) {
      content.forEach((part, partIndex) => {
        if (hasRef(part)) {
          refParts.push(part);
          locations.push({ message, part: partIndex });
        }
      });
    }
  });

  if (refParts.length === 0) {
    return messages;
  }

  const resolved = await resolve(refParts, context);

  // One replacement per input is the seam's contract. A count mismatch leaves
  // `undefined` in content, making the downstream AI SDK conversion fail with
  // an opaque error.
  if (!Array.isArray(resolved) || resolved.length !== refParts.length) {
    throw new Error(`resolveAttachments must return one part per input ref (expected ${refParts.length})`);
  }

  // Immutable splice-in: clone only the messages / content arrays we touch.
  const out = messages.slice();
  const clonedContent = new Map<number, unknown[]>();
  locations.forEach((loc, i) => {
    let content = clonedContent.get(loc.message);
    if (!content) {
      content = ((out[loc.message] as { content: unknown[] }).content).slice();
      clonedContent.set(loc.message, content);
      out[loc.message] = { ...out[loc.message], content } as Message;
    }
    content[loc.part] = resolved[i];
  });

  return out;
}
