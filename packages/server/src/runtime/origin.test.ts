import { describe, expect, test } from 'bun:test';
import { isOriginAllowed } from './origin';

const ALLOWED = ['https://app.example.com'];

describe('isOriginAllowed', () => {
  test('accepts every request when there is no allowlist', () => {
    expect(isOriginAllowed({ origin: undefined, secFetchSite: undefined }, undefined)).toBe(true);
    expect(isOriginAllowed({ origin: 'https://evil.example.com', secFetchSite: 'cross-site' }, undefined)).toBe(true);
  });

  test('accepts an Origin in the allowlist', () => {
    expect(isOriginAllowed({ origin: 'https://app.example.com', secFetchSite: undefined }, ALLOWED)).toBe(true);
  });

  test('refuses an Origin outside the allowlist, whatever Sec-Fetch-Site says', () => {
    expect(isOriginAllowed({ origin: 'https://evil.example.com', secFetchSite: 'same-origin' }, ALLOWED)).toBe(false);
  });

  test('accepts a missing Origin only when Sec-Fetch-Site is same-origin', () => {
    expect(isOriginAllowed({ origin: undefined, secFetchSite: 'same-origin' }, ALLOWED)).toBe(true);
    for (const secFetchSite of ['same-site', 'cross-site', 'none', undefined]) {
      expect(isOriginAllowed({ origin: undefined, secFetchSite }, ALLOWED)).toBe(false);
    }
  });
});
