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
    const fileContent: MultimodalContent[] = [{ type: 'image_url', url: 'data:...' }];
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

  it('persists a ref-bearing image attachment as stored_file', () => {
    const attachment = makeAttachment('a1', 'pic.png', 3, 'image/png');
    const fileContent: MultimodalContent[] = [{ type: 'image_ref', ref: 'tenant/ai/user/abc.png' }];
    const parts = buildPersistedParts('', [attachment], fileContent);
    expect(parts).toEqual([
      {
        type: 'stored_file',
        ref: 'tenant/ai/user/abc.png',
        name: 'pic.png',
        mimeType: 'image/png',
        size: 3,
      },
    ]);
  });

  it('persists a ref-bearing file (PDF) attachment as stored_file', () => {
    const attachment = makeAttachment('a1', 'doc.pdf', 8, 'application/pdf');
    const fileContent: MultimodalContent[] = [
      { type: 'file_ref', ref: 'tenant/ai/user/doc.pdf', mimeType: 'application/pdf', name: 'doc.pdf' },
    ];
    const parts = buildPersistedParts('', [attachment], fileContent);
    expect(parts).toEqual([
      {
        type: 'stored_file',
        ref: 'tenant/ai/user/doc.pdf',
        name: 'doc.pdf',
        mimeType: 'application/pdf',
        size: 8,
      },
    ]);
  });

  it('pairs interleaved image and file refs with attachments in order', () => {
    // Interleaved image + file attachments. Refs are emitted in attachment order,
    // so a single FIFO pairs each attachment with its own ref; the persisted kind
    // (image vs file) is carried by the attachment's mimeType, not the ref position.
    const img = makeAttachment('i1', 'a.png', 1, 'image/png');
    const pdf = makeAttachment('p1', 'b.pdf', 2, 'application/pdf');
    const fileContent: MultimodalContent[] = [
      { type: 'image_ref', ref: 'IMG-REF' },
      { type: 'file_ref', ref: 'PDF-REF', mimeType: 'application/pdf', name: 'b.pdf' },
    ];
    const parts = buildPersistedParts('', [img, pdf], fileContent);
    expect(parts).toEqual([
      { type: 'stored_file', ref: 'IMG-REF', name: 'a.png', mimeType: 'image/png', size: 1 },
      { type: 'stored_file', ref: 'PDF-REF', name: 'b.pdf', mimeType: 'application/pdf', size: 2 },
    ]);
  });

  it('keeps the ref pairing aligned when a transformed attachment sits between two refs', () => {
    // processAttachments emits the transformer group separately, so fileContent can
    // be reordered relative to attachments. The transformed attachment must consume
    // its transformed_file (by key) and NOT a ref slot, keeping refs aligned.
    const imgA = makeAttachment('a', 'a.png', 1, 'image/png');
    const pdfMid = makeAttachment('m', 'mid.pdf', 2, 'application/pdf');
    const imgC = makeAttachment('c', 'c.png', 3, 'image/png');
    const fileContent: MultimodalContent[] = [
      // transformer group emitted first
      { type: 'transformed_file', text: 'MID', originalFile: { name: 'mid.pdf', mimeType: 'application/pdf', size: 2 } },
      // null group: the two image refs, in attachment order
      { type: 'image_ref', ref: 'REF-A' },
      { type: 'image_ref', ref: 'REF-C' },
    ];
    const parts = buildPersistedParts('', [imgA, pdfMid, imgC], fileContent);
    expect(parts).toEqual([
      { type: 'stored_file', ref: 'REF-A', name: 'a.png', mimeType: 'image/png', size: 1 },
      { type: 'transformed_file', text: 'MID', originalFile: { name: 'mid.pdf', mimeType: 'application/pdf', size: 2 } },
      { type: 'stored_file', ref: 'REF-C', name: 'c.png', mimeType: 'image/png', size: 3 },
    ]);
  });

  it('does not let a url-bearing attachment steal a later attachment ref', () => {
    // A mixed (url then ref) batch: each attachment must read the ref off its OWN
    // part, so the url attachment stays metadata-only and the ref attachment keeps R.
    const urlImg = makeAttachment('u', 'u.png', 1, 'image/png');
    const refImg = makeAttachment('r', 'r.png', 2, 'image/png');
    const fileContent: MultimodalContent[] = [
      { type: 'image_url', url: 'data:image/png;base64,AAAA' },
      { type: 'image_ref', ref: 'R' },
    ];
    const parts = buildPersistedParts('', [urlImg, refImg], fileContent);
    expect(parts).toEqual([
      { type: 'file', file: { name: 'u.png', size: 1, mimeType: 'image/png' } },
      { type: 'stored_file', ref: 'R', name: 'r.png', mimeType: 'image/png', size: 2 },
    ]);
  });

  it('keeps duplicate ref images distinct via FIFO order', () => {
    const a1 = makeAttachment('a1', 'dup.png', 1, 'image/png');
    const a2 = makeAttachment('a2', 'dup.png', 1, 'image/png');
    const fileContent: MultimodalContent[] = [
      { type: 'image_ref', ref: 'REF-ONE' },
      { type: 'image_ref', ref: 'REF-TWO' },
    ];
    const parts = buildPersistedParts('', [a1, a2], fileContent);
    expect(parts.map((p) => (p as { ref?: string }).ref)).toEqual(['REF-ONE', 'REF-TWO']);
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
      { type: 'image_url', url: 'data:img' },
    ];
    const parts = buildPersistedParts('', [pdf1, img, pdf2], fileContent);
    expect(parts).toHaveLength(3);
    expect((parts[0] as { type: string; text?: string }).text).toBe('P1');
    expect(parts[1].type).toBe('file');
    expect((parts[2] as { type: string; text?: string }).text).toBe('P2');
  });
});
