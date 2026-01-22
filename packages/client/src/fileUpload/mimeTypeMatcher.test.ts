import { describe, it, expect } from 'bun:test';
import { matchesMimeType, findTransformer } from './mimeTypeMatcher';
import type { FileTransformer, FileTransformerMap } from './types';

describe('matchesMimeType', () => {
  it('matches exact MIME type', () => {
    expect(matchesMimeType('application/pdf', 'application/pdf')).toBe(true);
    expect(matchesMimeType('image/png', 'image/png')).toBe(true);
    expect(matchesMimeType('text/plain', 'text/plain')).toBe(true);
  });

  it('does not match different exact MIME types', () => {
    expect(matchesMimeType('application/pdf', 'image/png')).toBe(false);
    expect(matchesMimeType('text/html', 'text/plain')).toBe(false);
  });

  it('matches partial wildcard pattern', () => {
    expect(matchesMimeType('image/png', 'image/*')).toBe(true);
    expect(matchesMimeType('image/jpeg', 'image/*')).toBe(true);
    expect(matchesMimeType('image/gif', 'image/*')).toBe(true);
    expect(matchesMimeType('text/plain', 'text/*')).toBe(true);
    expect(matchesMimeType('application/json', 'application/*')).toBe(true);
  });

  it('does not match partial wildcard pattern from different category', () => {
    expect(matchesMimeType('application/pdf', 'image/*')).toBe(false);
    expect(matchesMimeType('text/html', 'image/*')).toBe(false);
  });

  it('matches universal wildcard patterns', () => {
    expect(matchesMimeType('anything/here', '*/*')).toBe(true);
    expect(matchesMimeType('application/pdf', '*/*')).toBe(true);
    expect(matchesMimeType('image/png', '*')).toBe(true);
    expect(matchesMimeType('text/plain', '*')).toBe(true);
  });
});

describe('findTransformer', () => {
  const pdfTransformer: FileTransformer = {
    transform: async () => 'pdf content',
  };
  const imageTransformer: FileTransformer = {
    transform: async () => 'image content',
  };
  const pngTransformer: FileTransformer = {
    transform: async () => 'png content',
  };
  const fallbackTransformer: FileTransformer = {
    transform: async () => 'fallback content',
  };

  it('returns exact match over wildcard', () => {
    const transformers: FileTransformerMap = {
      'image/*': imageTransformer,
      'image/png': pngTransformer,
    };

    const result = findTransformer('image/png', transformers);
    expect(result).toBe(pngTransformer);
  });

  it('returns partial wildcard over global wildcard', () => {
    const transformers: FileTransformerMap = {
      '*/*': fallbackTransformer,
      'image/*': imageTransformer,
    };

    const result = findTransformer('image/jpeg', transformers);
    expect(result).toBe(imageTransformer);
  });

  it('returns global wildcard when no better match', () => {
    const transformers: FileTransformerMap = {
      '*/*': fallbackTransformer,
      'image/*': imageTransformer,
    };

    const result = findTransformer('text/plain', transformers);
    expect(result).toBe(fallbackTransformer);
  });

  it('returns undefined when no match', () => {
    const transformers: FileTransformerMap = {
      'application/pdf': pdfTransformer,
    };

    const result = findTransformer('text/plain', transformers);
    expect(result).toBeUndefined();
  });

  it('returns single wildcard match', () => {
    const transformers: FileTransformerMap = {
      '*': fallbackTransformer,
    };

    const result = findTransformer('application/pdf', transformers);
    expect(result).toBe(fallbackTransformer);
  });

  it('returns more specific wildcard', () => {
    const transformers: FileTransformerMap = {
      '*': fallbackTransformer,
      'application/*': pdfTransformer,
    };

    const result = findTransformer('application/json', transformers);
    expect(result).toBe(pdfTransformer);
  });

  it('handles empty transformer map', () => {
    const result = findTransformer('image/png', {});
    expect(result).toBeUndefined();
  });

  it('handles complex specificity scenario', () => {
    const transformers: FileTransformerMap = {
      '*': fallbackTransformer,
      'image/*': imageTransformer,
      'image/png': pngTransformer,
      'application/pdf': pdfTransformer,
    };

    // Exact match wins
    expect(findTransformer('image/png', transformers)).toBe(pngTransformer);
    expect(findTransformer('application/pdf', transformers)).toBe(pdfTransformer);

    // Partial wildcard wins over global
    expect(findTransformer('image/jpeg', transformers)).toBe(imageTransformer);

    // Global wildcard when no better match
    expect(findTransformer('text/plain', transformers)).toBe(fallbackTransformer);
  });
});
