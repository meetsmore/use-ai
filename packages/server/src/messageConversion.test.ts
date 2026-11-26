import { describe, expect, test } from 'bun:test';
import { transformedFileToText } from '@meetsmore-oss/use-ai-core';
import { toModelMessages, safeJsonParse, getStringContent, convertToAISDKContent } from './messageConversion';
import type { Message } from './types';

describe('safeJsonParse', () => {
  test('returns the parsed value for valid JSON', () => {
    expect(safeJsonParse('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(safeJsonParse('null')).toEqual({ ok: true, value: null });
  });

  test('returns ok: false for invalid JSON and does not throw', () => {
    expect(safeJsonParse('not json')).toEqual({ ok: false });
    expect(safeJsonParse('')).toEqual({ ok: false });
  });
});

describe('transformedFileToText', () => {
  test('gives the exact text that the model sees', () => {
    expect(transformedFileToText({
      text: 'hello',
      originalFile: { name: 'a.txt', mimeType: 'text/plain' },
    })).toBe('[Content of file "a.txt" (text/plain)]:\n\nhello');
  });
});

describe('getStringContent', () => {
  test('joins the text blocks of an array', () => {
    expect(getStringContent([
      { type: 'text', text: 'a' },
      { type: 'image_url', url: 'data:image/png;base64,x' },
      { type: 'text', text: 'b' },
    ])).toBe('ab');
  });

  test('serializes an object and gives an empty string for no content', () => {
    expect(getStringContent({ x: 1 })).toBe('{"x":1}');
    expect(getStringContent(undefined)).toBe('');
  });
});

describe('convertToAISDKContent', () => {
  test('returns a single text part as a plain string', () => {
    expect(convertToAISDKContent([{ type: 'text', text: 'hi' }])).toBe('hi');
  });

  test('converts image, file and transformed_file parts', () => {
    expect(convertToAISDKContent([
      { type: 'text', text: 'look' },
      { type: 'image_url', url: 'data:image/png;base64,AAA' },
      { type: 'file_url', url: 'data:application/pdf;base64,BBB', mimeType: 'application/pdf', name: 'a.pdf' },
      { type: 'transformed_file', text: 'body', originalFile: { name: 'b.csv', mimeType: 'text/csv', size: 4 } },
    ])).toEqual([
      { type: 'text', text: 'look' },
      { type: 'image', image: 'data:image/png;base64,AAA' },
      { type: 'file', data: 'data:application/pdf;base64,BBB', mediaType: 'application/pdf' },
      { type: 'text', text: '[Content of file "b.csv" (text/csv)]:\n\nbody' },
    ]);
  });

  test('uses default name and MIME type when a transformed_file has no originalFile', () => {
    expect(convertToAISDKContent([{ type: 'transformed_file', text: 'body' }]))
      .toBe('[Content of file "file" (application/octet-stream)]:\n\nbody');
  });

  test('drops unknown blocks and gives an empty string when nothing is left', () => {
    expect(convertToAISDKContent([{ type: 'image_ref', ref: 'k' }])).toBe('');
  });
});

describe('toModelMessages', () => {
  test('converts user and plain assistant messages', () => {
    const messages = [
      { id: '1', role: 'user', content: 'hi' },
      { id: '2', role: 'assistant', content: 'hello' },
    ] as Message[];
    expect(toModelMessages(messages)).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
  });

  test('converts reasoning parts and tool calls with provider metadata', () => {
    const messages = [{
      id: '1',
      role: 'assistant',
      content: 'text',
      reasoningParts: [
        { text: 'think', encryptedValue: '{"anthropic":{"signature":"s"}}' },
        { text: 'bad', encryptedValue: 'not json' },
      ],
      toolCalls: [
        { id: 'tc1', type: 'function', function: { name: 'add', arguments: '{"x":1}' }, encryptedValue: '{"google":{"t":"g"}}' },
        { id: 'tc2', type: 'function', function: { name: 'raw', arguments: 'not json' } },
      ],
    }] as Message[];
    expect(toModelMessages(messages)).toEqual([{
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'think', providerMetadata: { anthropic: { signature: 's' } } },
        { type: 'reasoning', text: 'bad' },
        { type: 'text', text: 'text' },
        { type: 'tool-call', toolCallId: 'tc1', toolName: 'add', input: { x: 1 }, providerMetadata: { google: { t: 'g' } } },
        { type: 'tool-call', toolCallId: 'tc2', toolName: 'raw', input: 'not json' },
      ],
    }]);
  });

  test('resolves the tool name and metadata of a tool result from an earlier tool call', () => {
    const messages = [
      {
        id: '1',
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'tc1', type: 'function', function: { name: 'add', arguments: '{}' }, encryptedValue: '{"google":{"t":"g"}}' }],
      },
      { id: '2', role: 'tool', toolCallId: 'tc1', content: '{"ok":true}' },
      { id: '3', role: 'tool', toolCallId: 'missing', content: 'plain' },
    ] as Message[];
    const [, json, text] = toModelMessages(messages);
    expect(json).toEqual({
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: 'tc1',
        toolName: 'add',
        output: { type: 'json', value: { ok: true } },
        providerMetadata: { google: { t: 'g' } },
      }],
    });
    expect(text).toEqual({
      role: 'tool',
      content: [{ type: 'tool-result', toolCallId: 'missing', toolName: 'unknown', output: { type: 'text', value: 'plain' } }],
    });
  });

  test('converts a message with another role to a user message', () => {
    const messages = [{ id: '1', role: 'developer', content: 'note' }] as Message[];
    expect(toModelMessages(messages)).toEqual([{ role: 'user', content: 'note' }]);
  });
});
