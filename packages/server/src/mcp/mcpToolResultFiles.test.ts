import { describe, test, expect } from 'bun:test';
import {
  extractFilesFromMcpContent,
  omitToolResultFiles,
  toModelOutputWithFiles,
  USE_AI_FILES,
  USE_AI_FILES_NOTE_KEY,
} from './mcpToolResultFiles';

describe('extractFilesFromMcpContent', () => {
  test('takes image parts and PDF/image resources with a blob', () => {
    const files = extractFilesFromMcpContent([
      { type: 'text', text: 'hello' },
      { type: 'image', data: 'aW1n', mimeType: 'image/jpeg' },
      { type: 'resource', resource: { uri: 'file:///a/%E8%A6%8B%E7%A9%8D.pdf', mimeType: 'application/pdf', blob: 'cGRm' } },
    ]);

    expect(files).toEqual([
      { mediaType: 'image/jpeg', data: 'aW1n' },
      { mediaType: 'application/pdf', data: 'cGRm', filename: '見積.pdf' },
    ]);
  });

  test('leaves out media types the model cannot read and resources without a blob', () => {
    const files = extractFilesFromMcpContent([
      { type: 'resource', resource: { uri: 'file:///a.xlsx', mimeType: 'application/vnd.ms-excel', blob: 'eA==' } },
      { type: 'resource', resource: { uri: 'file:///a.pdf', mimeType: 'application/pdf', text: 'x' } },
      { type: 'image', mimeType: 'image/png' },
      { type: 'audio', data: 'YQ==', mimeType: 'audio/wav' },
    ]);

    expect(files).toEqual([]);
  });
});

describe('toModelOutputWithFiles', () => {
  test('matches the AI SDK default output when there are no files', () => {
    expect(toModelOutputWithFiles('plain')).toEqual({ type: 'text', value: 'plain' });
    expect(toModelOutputWithFiles({ ok: true })).toEqual({ type: 'json', value: { ok: true } });
  });

  test('puts the rest of the result as text and each file as a content part', () => {
    const output = toModelOutputWithFiles({
      name: 'quote.pdf',
      [USE_AI_FILES]: [
        { mediaType: 'image/png', data: 'aW1n' },
        { mediaType: 'application/pdf', data: 'cGRm', filename: 'quote.pdf' },
      ],
    });

    expect(output).toEqual({
      type: 'content',
      value: [
        { type: 'text', text: '{"name":"quote.pdf"}' },
        { type: 'image-data', data: 'aW1n', mediaType: 'image/png' },
        { type: 'file-data', data: 'cGRm', mediaType: 'application/pdf', filename: 'quote.pdf' },
      ],
    });
  });
});

describe('toModelOutputWithFiles with mediaParts', () => {
  test('writes every file as a media part, for the AI Gateway', () => {
    const output = toModelOutputWithFiles(
      {
        name: 'quote.pdf',
        [USE_AI_FILES]: [
          { mediaType: 'image/png', data: 'aW1n' },
          { mediaType: 'application/pdf', data: 'cGRm', filename: 'quote.pdf' },
        ],
      },
      { mediaParts: true }
    );

    expect(output).toEqual({
      type: 'content',
      value: [
        { type: 'text', text: '{"name":"quote.pdf"}' },
        { type: 'media', data: 'aW1n', mediaType: 'image/png' },
        { type: 'media', data: 'cGRm', mediaType: 'application/pdf' },
      ],
    });
  });
});

describe('omitToolResultFiles', () => {
  test('replaces file data with a note and keeps the rest', () => {
    const omitted = omitToolResultFiles({
      name: 'quote.pdf',
      [USE_AI_FILES]: [{ mediaType: 'application/pdf', data: 'cGRm', filename: 'quote.pdf' }],
    }) as Record<string, unknown>;

    expect(omitted.name).toBe('quote.pdf');
    expect(JSON.stringify(omitted)).not.toContain('cGRm');
    expect(omitted[USE_AI_FILES_NOTE_KEY]).toEqual([
      { mediaType: 'application/pdf', filename: 'quote.pdf', note: expect.stringContaining('Call the tool again') },
    ]);
  });

  test('returns outputs without files as they are', () => {
    const output = { ok: true };
    expect(omitToolResultFiles(output)).toBe(output);
    expect(omitToolResultFiles('text')).toBe('text');
  });
});
