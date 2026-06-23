import type {
  Message,
  MultimodalContent,
  ResolveAttachments,
  ResolveAttachmentsContext,
} from '@meetsmore-oss/use-ai-core';

/**
 * Whether a part is a ref-bearing attachment wire part: an `image`/`file` part
 * carrying a non-empty string `ref`, awaiting just-in-time resolution.
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
 * Resolve every ref-bearing attachment part across a run's message history,
 * once, before the messages are converted to AI SDK format.
 *
 * Gathers all ref parts from the history, calls the host's `resolve` seam a
 * single time (batched), and splices the returned parts back into their original
 * positions. The host is responsible for turning each ref into something the
 * model can read (a signed-URL `image`/`file` part, or a `text` fallback when a
 * file is missing/unavailable) — see {@link ResolveAttachments}.
 *
 * `resolve` is the host's `resolveAttachments` seam (type {@link ResolveAttachments},
 * configured on `UseAIServerConfig`); this helper just drives it over a whole history.
 *
 * Returns the original `messages` reference unchanged when there are no refs.
 * Otherwise returns a new array; only the messages and content arrays that are
 * actually touched are cloned, so this function never mutates the caller's input.
 *
 * @throws If `resolve` returns a different number of parts than it was given
 *   (a contract violation — the host must return one replacement per input).
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

  // One replacement per input is the seam contract. A mismatch would splice
  // `undefined` into the content and crash the AI SDK conversion downstream with
  // an opaque error, so fail fast here with a clear one instead.
  if (!Array.isArray(resolved) || resolved.length !== refParts.length) {
    throw new Error(`resolveAttachments must return one part per input ref (expected ${refParts.length})`);
  }

  // Immutable splice: clone only the messages / content arrays we touch.
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
