import { describe, it, expect } from 'bun:test';
import { buildPersistedParts } from './buildPersistedParts';
import type { FileAttachment } from './types';
import type { MultimodalContent } from '@meetsmore-oss/use-ai-core';

function makeAttachment(id: string, name: string, size: number, type: string): FileAttachment {
  return {
    id,
    file: new File(['x'.repeat(size)], name, { type, lastModified: 0 }),
  };
}

describe('buildPersistedParts', () => {
  it('emits a text part when message is non-empty', () => {
    const parts = buildPersistedParts('hello', [], []);
    expect(parts).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('omits the text part when message is whitespace only', () => {
    const parts = buildPersistedParts('  ', [], []);
    expect(parts).toEqual([]);
  });

  it('pairs each transformed_file part with the matching attachment and persists the text', () => {
    const attachment = makeAttachment('a1', 'doc.pdf', 10, 'application/pdf');
    const fileContent: MultimodalContent[] = [{
      type: 'transformed_file',
      text: 'OCR body',
      originalFile: { name: 'doc.pdf', mimeType: 'application/pdf', size: 10 },
    }];
    const parts = buildPersistedParts('intro', [attachment], fileContent);
    expect(parts).toEqual([
      { type: 'text', text: 'intro' },
      {
        type: 'transformed_file',
        text: 'OCR body',
        originalFile: { name: 'doc.pdf', mimeType: 'application/pdf', size: 10 },
      },
    ]);
  });

  it('falls back to metadata-only when the attachment has no transformed output', () => {
    const attachment = makeAttachment('a1', 'pic.png', 3, 'image/png');
    const fileContent: MultimodalContent[] = [{ type: 'image', url: 'data:...' }];
    const parts = buildPersistedParts('', [attachment], fileContent);
    expect(parts).toEqual([
      {
        type: 'file',
        file: { name: 'pic.png', size: 3, mimeType: 'image/png' },
      },
    ]);
  });

  it('distinguishes duplicate attachments with identical metadata using order, not a single shared key', () => {
    // Two separate attachments that happen to share name/size/mimeType.
    // Each gets its own transformed text — no overwrite.
    const a1 = makeAttachment('a1', 'dup.pdf', 10, 'application/pdf');
    const a2 = makeAttachment('a2', 'dup.pdf', 10, 'application/pdf');
    const fileContent: MultimodalContent[] = [
      {
        type: 'transformed_file',
        text: 'TEXT-ONE',
        originalFile: { name: 'dup.pdf', mimeType: 'application/pdf', size: 10 },
      },
      {
        type: 'transformed_file',
        text: 'TEXT-TWO',
        originalFile: { name: 'dup.pdf', mimeType: 'application/pdf', size: 10 },
      },
    ];
    const parts = buildPersistedParts('intro', [a1, a2], fileContent);
    // Both attachments must resolve to distinct transformed_file parts.
    const transformed = parts.filter((p) => p.type === 'transformed_file');
    expect(transformed).toHaveLength(2);
    expect((transformed[0] as { text: string }).text).toBe('TEXT-ONE');
    expect((transformed[1] as { text: string }).text).toBe('TEXT-TWO');
  });

  it('preserves attachment input order in the output', () => {
    // processAttachments groups by transformer, so fileContent may be
    // reordered relative to attachments. buildPersistedParts must emit
    // parts in attachment input order.
    const pdf1 = makeAttachment('p1', 'first.pdf', 1, 'application/pdf');
    const img = makeAttachment('i1', 'pic.png', 1, 'image/png');
    const pdf2 = makeAttachment('p2', 'second.pdf', 1, 'application/pdf');
    const fileContent: MultimodalContent[] = [
      // transformer group emitted first
      { type: 'transformed_file', text: 'P1', originalFile: { name: 'first.pdf', mimeType: 'application/pdf', size: 1 } },
      { type: 'transformed_file', text: 'P2', originalFile: { name: 'second.pdf', mimeType: 'application/pdf', size: 1 } },
      // null (no-transformer) group emitted second
      { type: 'image', url: 'data:img' },
    ];
    const parts = buildPersistedParts('', [pdf1, img, pdf2], fileContent);
    expect(parts).toHaveLength(3);
    expect((parts[0] as { type: string; text?: string }).text).toBe('P1');
    expect(parts[1].type).toBe('file');
    expect((parts[2] as { type: string; text?: string }).text).toBe('P2');
  });
});
