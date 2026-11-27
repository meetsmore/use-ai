import { describe, expect, test } from 'bun:test';
import { splitBase64DataUrl } from './dataUrl';

describe('splitBase64DataUrl', () => {
  test('splits a base64 data url into media type and data', () => {
    expect(splitBase64DataUrl('data:image/png;base64,iVBORw0KGgo=')).toEqual({ mediaType: 'image/png', data: 'iVBORw0KGgo=' });
  });

  test('keeps the media type when the data url has parameters', () => {
    expect(splitBase64DataUrl('data:application/pdf;name=d.pdf;base64,JVBERi0=')).toEqual({ mediaType: 'application/pdf', data: 'JVBERi0=' });
  });

  test('returns undefined for urls that are not base64 data urls', () => {
    expect(splitBase64DataUrl('https://example.com/a.png')).toBeUndefined();
    expect(splitBase64DataUrl('data:text/plain,hello')).toBeUndefined();
  });
});
