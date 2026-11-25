import { describe, it, expect } from 'bun:test';
import { resolveAttachmentParts, countRefParts, dropRemoteUrlParts } from './attachmentResolution';
import type { Message, MultimodalContent, ResolveAttachmentsContext } from '@meetsmore-oss/use-ai-core';

const ctx: ResolveAttachmentsContext = { forwardedProps: { token: 'jwt-123' } };

// Cast helper: tests build loose AG-UI-ish messages with use-ai wire content.
function msg(role: string, content: unknown): Message {
  return { id: role, role, content } as unknown as Message;
}

describe('resolveAttachmentParts', () => {
  it('returns the original messages reference when there are no refs', async () => {
    const messages = [msg('user', 'hello'), msg('user', [{ type: 'text', text: 'hi' }])];
    const resolve = async () => {
      throw new Error('resolve should not be called');
    };
    const result = await resolveAttachmentParts(messages, resolve, ctx);
    expect(result).toBe(messages);
  });

  it('collects refs across the history and calls resolve once with all of them', async () => {
    const messages = [
      msg('user', [
        { type: 'text', text: 'a' },
        { type: 'image_ref', ref: 'REF-1' },
      ]),
      msg('assistant', 'ok'),
      msg('user', [{ type: 'file_ref', ref: 'REF-2', mimeType: 'application/pdf', name: 'd.pdf' }]),
    ];
    let calls = 0;
    let received: MultimodalContent[] = [];
    const resolve = async (parts: MultimodalContent[]) => {
      calls++;
      received = parts;
      return parts.map((p) => ({ type: 'image_url' as const, url: `https://signed/${(p as { ref: string }).ref}` }));
    };
    const result = await resolveAttachmentParts(messages, resolve, ctx);

    expect(calls).toBe(1);
    expect(received.map((p) => (p as { ref: string }).ref)).toEqual(['REF-1', 'REF-2']);
    // Replacements spliced back into their original positions.
    expect((result[0].content as unknown[])[1]).toEqual({ type: 'image_url', url: 'https://signed/REF-1' });
    expect((result[2].content as unknown[])[0]).toEqual({ type: 'image_url', url: 'https://signed/REF-2' });
    // Non-ref parts untouched.
    expect((result[0].content as unknown[])[0]).toEqual({ type: 'text', text: 'a' });
    expect(result[1].content).toBe('ok');
  });

  it('does not mutate the input messages', async () => {
    const original = msg('user', [{ type: 'image_ref', ref: 'REF-1' }]);
    const messages = [original];
    const snapshot = JSON.parse(JSON.stringify(original));
    const resolve = async (parts: MultimodalContent[]) =>
      parts.map(() => ({ type: 'text' as const, text: 'unavailable' }));
    const result = await resolveAttachmentParts(messages, resolve, ctx);

    expect(result).not.toBe(messages);
    expect(result[0]).not.toBe(original);
    // Original untouched.
    expect(original).toEqual(snapshot);
    // Result has the replacement.
    expect((result[0].content as unknown[])[0]).toEqual({ type: 'text', text: 'unavailable' });
  });

  it('preserves order when a single message has multiple refs', async () => {
    const messages = [
      msg('user', [
        { type: 'image_ref', ref: 'A' },
        { type: 'text', text: 'between' },
        { type: 'image_ref', ref: 'B' },
      ]),
    ];
    const resolve = async (parts: MultimodalContent[]) =>
      parts.map((p) => ({ type: 'text' as const, text: (p as { ref: string }).ref }));
    const result = await resolveAttachmentParts(messages, resolve, ctx);
    const content = result[0].content as unknown[];
    expect(content[0]).toEqual({ type: 'text', text: 'A' });
    expect(content[1]).toEqual({ type: 'text', text: 'between' });
    expect(content[2]).toEqual({ type: 'text', text: 'B' });
  });

  it('passes the context through to resolve', async () => {
    const messages = [msg('user', [{ type: 'image_ref', ref: 'REF' }])];
    let seen: ResolveAttachmentsContext | undefined;
    const resolve = async (parts: MultimodalContent[], context: ResolveAttachmentsContext) => {
      seen = context;
      return parts.map(() => ({ type: 'text' as const, text: 'x' }));
    };
    await resolveAttachmentParts(messages, resolve, ctx);
    expect(seen?.forwardedProps?.token).toBe('jwt-123');
  });

  it('throws when resolve returns a different count than it was given', async () => {
    const messages = [msg('user', [{ type: 'image_ref', ref: 'A' }, { type: 'image_ref', ref: 'B' }])];
    const resolve = async () => [{ type: 'text' as const, text: 'only-one' }];
    await expect(resolveAttachmentParts(messages, resolve, ctx)).rejects.toThrow(/one part per input ref/);
  });

  it('ignores empty-string refs', async () => {
    const messages = [msg('user', [{ type: 'image_ref', ref: '' }])];
    const resolve = async () => {
      throw new Error('should not be called for empty ref');
    };
    const result = await resolveAttachmentParts(messages, resolve, ctx);
    expect(result).toBe(messages);
  });
});

describe('countRefParts', () => {
  it('counts surviving ref parts across all messages', () => {
    const messages = [
      msg('user', [{ type: 'text', text: 'a' }, { type: 'image_ref', ref: 'R1' }]),
      msg('assistant', 'ok'),
      msg('user', [{ type: 'file_ref', ref: 'R2', mimeType: 'application/pdf', name: 'd.pdf' }]),
    ];
    expect(countRefParts(messages)).toBe(2);
  });

  it('returns 0 once refs are resolved (url/text/string parts have no ref)', () => {
    const messages = [
      msg('user', [{ type: 'image_url', url: 'https://signed/x' }]),
      msg('user', [{ type: 'text', text: 'unavailable' }]),
      msg('user', 'plain string'),
    ];
    expect(countRefParts(messages)).toBe(0);
  });
});

describe('dropRemoteUrlParts', () => {
  it.each([
    ['http', 'http://169.254.169.254/latest/meta-data/'],
    ['https', 'https://internal.example/secret'],
    ['file', 'file:///proc/self/environ'],
  ])('drops image_url and file_url parts with a %s url', (_scheme, url) => {
    const messages = [
      msg('user', [
        { type: 'text', text: 'read this' },
        { type: 'image_url', url },
        { type: 'file_url', url, mimeType: 'text/plain', name: 'x.txt' },
      ]),
    ];
    const result = dropRemoteUrlParts(messages);
    expect(result.dropped).toBe(2);
    expect(result.messages[0].content).toEqual([{ type: 'text', text: 'read this' }]);
  });

  it('drops url parts whose url is not a string', () => {
    const messages = [msg('user', [{ type: 'file_url', url: { href: 'http://x' }, mimeType: 'text/plain', name: 'x' }])];
    expect(dropRemoteUrlParts(messages).dropped).toBe(1);
  });

  it('drops url parts in non-user messages too', () => {
    const messages = [msg('assistant', [{ type: 'image_url', url: 'http://x/a.png' }])];
    expect(dropRemoteUrlParts(messages).dropped).toBe(1);
  });

  it('keeps data urls, raw base64, refs and text, returning the original reference', () => {
    const messages = [
      msg('user', [
        { type: 'text', text: 'a' },
        { type: 'image_url', url: 'data:image/png;base64,AAAA' },
        { type: 'file_url', url: 'DATA:application/pdf;base64,JVBERi0=', mimeType: 'application/pdf', name: 'd.pdf' },
        { type: 'file_url', url: 'JVBERi0xLjQK', mimeType: 'application/pdf', name: 'raw.pdf' },
        { type: 'image_ref', ref: 'REF-1' },
      ]),
      msg('user', 'plain string'),
    ];
    const result = dropRemoteUrlParts(messages);
    expect(result.dropped).toBe(0);
    expect(result.messages).toBe(messages);
  });

  it('does not mutate the input messages', () => {
    const original = msg('user', [{ type: 'image_url', url: 'http://x/a.png' }]);
    const snapshot = JSON.parse(JSON.stringify(original));
    dropRemoteUrlParts([original]);
    expect(original).toEqual(snapshot);
  });
});
