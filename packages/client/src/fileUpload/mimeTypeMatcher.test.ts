import { describe, it, expect } from 'bun:test';
import { matchesMimeType, findTransformer } from './mimeTypeMatcher';
import type { FileTransformerMap } from './types';

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
  // Dummy transformers (values don't matter — findTransformer returns the key)
  const stub = { transform: async () => [] } as unknown as FileTransformerMap[string];

  it('returns exact match over wildcard', () => {
    const transformers: FileTransformerMap = {
      'image/*': stub,
      'image/png': stub,
    };

    expect(findTransformer('image/png', transformers)).toBe('image/png');
  });

  it('returns partial wildcard over global wildcard', () => {
    const transformers: FileTransformerMap = {
      '*/*': stub,
      'image/*': stub,
    };

    expect(findTransformer('image/jpeg', transformers)).toBe('image/*');
  });

  it('returns global wildcard when no better match', () => {
    const transformers: FileTransformerMap = {
      '*/*': stub,
      'image/*': stub,
    };

    expect(findTransformer('text/plain', transformers)).toBe('*/*');
  });

  it('returns undefined when no match', () => {
    const transformers: FileTransformerMap = {
      'application/pdf': stub,
    };

    expect(findTransformer('text/plain', transformers)).toBeUndefined();
  });

  it('returns single wildcard match', () => {
    const transformers: FileTransformerMap = {
      '*': stub,
    };

    expect(findTransformer('application/pdf', transformers)).toBe('*');
  });

  it('returns more specific wildcard', () => {
    const transformers: FileTransformerMap = {
      '*': stub,
      'application/*': stub,
    };

    expect(findTransformer('application/json', transformers)).toBe('application/*');
  });

  it('handles empty transformer map', () => {
    expect(findTransformer('image/png', {})).toBeUndefined();
  });

  it('handles complex specificity scenario', () => {
    const transformers: FileTransformerMap = {
      '*': stub,
      'image/*': stub,
      'image/png': stub,
      'application/pdf': stub,
    };

    // Exact match wins
    expect(findTransformer('image/png', transformers)).toBe('image/png');
    expect(findTransformer('application/pdf', transformers)).toBe('application/pdf');

    // Partial wildcard wins over global
    expect(findTransformer('image/jpeg', transformers)).toBe('image/*');

    // Global wildcard when no better match
    expect(findTransformer('text/plain', transformers)).toBe('*');
  });
});
