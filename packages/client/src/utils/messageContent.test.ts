import { describe, it, expect } from 'bun:test';
import { getTextFromContent, getDisplayTextFromContent } from './messageContent';
import type { PersistedMessageContent } from '../providers/chatRepository/types';

describe('getTextFromContent', () => {
  it('returns a plain string unchanged', () => {
    expect(getTextFromContent('hello')).toBe('hello');
  });

  it('joins mixed text and transformed_file parts', () => {
    const content: PersistedMessageContent = [
      { type: 'text', text: 'intro' },
      {
        type: 'transformed_file',
        text: 'OCR body',
        originalFile: { name: 'a.pdf', mimeType: 'application/pdf', size: 1 },
      },
    ];
    expect(getTextFromContent(content)).toBe('intro\nOCR body');
  });

  it('drops legacy metadata-only file parts without throwing', () => {
    const content: PersistedMessageContent = [
      { type: 'text', text: 'only text' },
      { type: 'file', file: { name: 'a.pdf', mimeType: 'application/pdf', size: 1 } },
    ];
    expect(getTextFromContent(content)).toBe('only text');
  });

  it('returns an empty string for an empty array', () => {
    expect(getTextFromContent([])).toBe('');
  });
});

describe('getDisplayTextFromContent', () => {
  it('returns a plain string unchanged', () => {
    expect(getDisplayTextFromContent('hello')).toBe('hello');
  });

  it('omits transformed_file text so OCR body does not leak into UI/title', () => {
    const content: PersistedMessageContent = [
      { type: 'text', text: 'intro' },
      {
        type: 'transformed_file',
        text: 'huge OCR body',
        originalFile: { name: 'a.pdf', mimeType: 'application/pdf', size: 1 },
      },
    ];
    expect(getDisplayTextFromContent(content)).toBe('intro');
  });

  it('drops legacy metadata-only file parts', () => {
    const content: PersistedMessageContent = [
      { type: 'text', text: 'only text' },
      { type: 'file', file: { name: 'a.pdf', mimeType: 'application/pdf', size: 1 } },
    ];
    expect(getDisplayTextFromContent(content)).toBe('only text');
  });

  it('returns an empty string for an empty array', () => {
    expect(getDisplayTextFromContent([])).toBe('');
  });
});
