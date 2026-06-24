import type {
  Message,
  MultimodalContent,
  ResolveAttachments,
  ResolveAttachmentsContext,
} from '@meetsmore-oss/use-ai-core';

/**
 * Whether `part` is an attachment wire part carrying a `ref`: an `image`/`file`
 * part with a non-empty `ref` string, awaiting resolution when needed.
 */
function hasRef(part: unknown): part is MultimodalContent {
  if (typeof part !== 'object' || part === null) {
    return false;
  }
  const p = part as { type?: unknown; ref?: unknown };
  return (
    (p.type === 'image' || p.type === 'file') &&
    typeof p.ref === 'string' &&
    p.ref.length > 0
  );
}

/**
 * Counts only ref parts without a `url` (the ones actually dropped during
 * conversion), for observability. Parts carrying both `url` and `ref` are not
 * counted, since they reach the model via the `url`.
 */
export function countRefParts(messages: Message[]): number {
  let count = 0;
  for (const msg of messages) {
    const content = (msg as { content?: unknown }).content;
    if (Array.isArray(content)) {
      for (const part of content) {
        if (hasRef(part) && !('url' in (part as { url?: unknown }))) count++;
      }
    }
  }
  return count;
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
