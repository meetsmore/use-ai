import { describe, test, expect, spyOn } from 'bun:test';
import type { McpHeadersMap } from '@meetsmore-oss/use-ai-core';
import { validateMcpHeaderPattern, findMcpHeadersForUrl } from './mcpHeaderPatterns';
import { logger } from '../logger';

describe('validateMcpHeaderPattern', () => {
  describe('accepts a pattern with a domain', () => {
    test.each([
      ['literal host', 'https://api.proone.jp/api/mcp'],
      ['literal host without a path', 'https://api.proone.jp'],
      ['localhost', 'http://localhost/mcp'],
      ['localhost with a port', 'http://localhost:3030/mcp'],
      ['IPv4 literal with a port', 'http://127.0.0.1:8080/mcp'],
      ['IPv6 literal with a port', 'http://[::1]:3000/mcp'],
      ['leading *. before a registrable domain', 'https://*.proone.jp/api/mcp'],
      ['leading *. before a subdomain', 'https://*.api.proone.jp/mcp'],
      ['*. form with a port', 'https://*.proone.jp:8443/mcp'],
      ['scheme glob', '*://api.proone.jp/api/mcp'],
      ['scheme brace glob', '{http,https}://api.proone.jp/api/mcp'],
      ['path glob', 'https://api.proone.jp/**'],
      ['*. before a PSL exception domain (city.kawasaki.jp)', 'https://*.city.kawasaki.jp/api/mcp'],
      ['*. before a domain under a PSL wildcard suffix', 'https://*.foo.bar.kawasaki.jp/api/mcp'],
    ])('%s: %s', (_name, pattern) => {
      expect(validateMcpHeaderPattern(pattern)).toBeNull();
    });
  });

  describe('rejects a pattern without a domain', () => {
    test.each([
      ['wildcard host (meetsone pattern)', '*://*/api/mcp'],
      ['wildcard host', 'https://*/api/mcp'],
      ['globstar host', 'https://**/api/mcp'],
      ['*. before a public suffix (jp)', 'https://*.jp/api/mcp'],
      ['*. before a public suffix (co.jp)', 'https://*.co.jp/api/mcp'],
      ['*. before a public suffix (com)', 'https://*.com/api/mcp'],
      ['*. before a private public suffix (github.io)', 'https://*.github.io/api/mcp'],
      ['*. before a PSL wildcard parent (kawasaki.jp)', 'https://*.kawasaki.jp/api/mcp'],
      ['*. before a PSL wildcard parent (sch.uk)', 'https://*.sch.uk/api/mcp'],
      ['*. before a single label', 'https://*.localhost/api/mcp'],
      ['*. before an IP address', 'https://*.0.0.1/api/mcp'],
      ['wildcard in the middle of a label', 'https://api*.proone.jp/api/mcp'],
      ['wildcard label in the middle', 'https://a.*.proone.jp/api/mcp'],
      ['two wildcard labels', 'https://*.*.proone.jp/api/mcp'],
      ['globstar label', 'https://**.proone.jp/api/mcp'],
      ['question mark in host', 'https://api.proone.?p/api/mcp'],
      ['character class in host', 'https://[a-z].proone.jp/api/mcp'],
      ['brace in host', 'https://{a,b}.proone.jp/api/mcp'],
      ['wildcard port', 'https://api.proone.jp:*/api/mcp'],
      ['partial wildcard port', 'https://api.proone.jp:80*/api/mcp'],
      ['port out of range', 'https://api.proone.jp:70000/api/mcp'],
      ['user info', 'https://user@api.proone.jp/api/mcp'],
      ['empty host', 'https:///api/mcp'],
      ['no scheme', 'api.proone.jp/api/mcp'],
      ['bare wildcard', '*'],
      ['empty string', ''],
    ])('%s: %s', (_name, pattern) => {
      expect(validateMcpHeaderPattern(pattern)).toEqual(expect.any(String));
    });
  });
});

describe('findMcpHeadersForUrl', () => {
  const token = { headers: { Authorization: 'Bearer user-jwt' } };

  const matches = (url: string, pattern: string) =>
    findMcpHeadersForUrl(url, { [pattern]: token }) !== undefined;

  describe('*. host form', () => {
    const pattern = 'https://*.proone.jp/api/mcp';

    test('matches a direct subdomain', () => {
      expect(matches('https://a.proone.jp/api/mcp', pattern)).toBe(true);
    });

    test('matches a subdomain at any depth', () => {
      expect(matches('https://a.b.proone.jp/api/mcp', pattern)).toBe(true);
    });

    test('does not match the apex domain', () => {
      expect(matches('https://proone.jp/api/mcp', pattern)).toBe(false);
    });

    test('does not match a domain that only ends with the same text', () => {
      expect(matches('https://evilproone.jp/api/mcp', pattern)).toBe(false);
    });

    test('does not match a domain that contains the domain as a label', () => {
      expect(matches('https://proone.jp.evil.com/api/mcp', pattern)).toBe(false);
    });
  });

  describe('literal host', () => {
    test('matches the same host, ignoring case', () => {
      expect(matches('https://api.proone.jp/api/mcp', 'https://API.proone.jp/api/mcp')).toBe(true);
    });

    test('does not match a subdomain', () => {
      expect(matches('https://x.api.proone.jp/api/mcp', 'https://api.proone.jp/api/mcp')).toBe(false);
    });

    test('without a path, matches only the root path', () => {
      expect(matches('https://api.proone.jp/', 'https://api.proone.jp')).toBe(true);
      expect(matches('https://api.proone.jp/api/mcp', 'https://api.proone.jp')).toBe(false);
    });

    test('matches an IPv6 literal', () => {
      expect(matches('http://[::1]:3000/mcp', 'http://[::1]:3000/mcp')).toBe(true);
    });
  });

  describe('port', () => {
    test('matches the same port', () => {
      expect(matches('http://localhost:3030/mcp', 'http://localhost:3030/mcp')).toBe(true);
    });

    test('does not match a different port', () => {
      expect(matches('http://localhost:3031/mcp', 'http://localhost:3030/mcp')).toBe(false);
    });

    test('a pattern with a port does not match the URL without a port', () => {
      expect(matches('http://localhost/mcp', 'http://localhost:3030/mcp')).toBe(false);
    });

    test('a pattern without a port does not match a URL with a non-default port', () => {
      expect(matches('http://localhost:3030/mcp', 'http://localhost/mcp')).toBe(false);
    });

    test('an explicit default port matches the URL without a port', () => {
      expect(matches('https://api.proone.jp/mcp', 'https://api.proone.jp:443/mcp')).toBe(true);
    });
  });

  describe('scheme and path globs', () => {
    test('scheme glob matches http and https', () => {
      expect(matches('https://api.proone.jp/api/mcp', '*://api.proone.jp/api/mcp')).toBe(true);
      expect(matches('http://api.proone.jp/api/mcp', '*://api.proone.jp/api/mcp')).toBe(true);
    });

    test('scheme must match', () => {
      expect(matches('http://api.proone.jp/api/mcp', 'https://api.proone.jp/api/mcp')).toBe(false);
    });

    test('single star in the path matches one segment', () => {
      expect(matches('http://localhost:3002/mcp', 'http://localhost:3002/*')).toBe(true);
      expect(matches('http://localhost:3002/api/mcp', 'http://localhost:3002/*')).toBe(false);
    });

    test('globstar in the path matches several segments', () => {
      expect(matches('http://localhost:3002/api/mcp', 'http://localhost:3002/**')).toBe(true);
    });
  });

  describe('invalid patterns', () => {
    test('are never used, and a warning names the pattern without header values', () => {
      const warnSpy = spyOn(logger, 'warn');
      try {
        const result = findMcpHeadersForUrl('https://api.proone.jp/api/mcp', {
          '*://*/api/mcp': token,
        });

        expect(result).toBeUndefined();
        expect(warnSpy).toHaveBeenCalled();
        const logged = JSON.stringify(warnSpy.mock.calls);
        expect(logged).toContain('*://*/api/mcp');
        expect(logged).not.toContain('user-jwt');
      } finally {
        warnSpy.mockRestore();
      }
    });

    test('do not stop a valid pattern from matching', () => {
      const valid = { headers: { Authorization: 'Bearer valid' } };
      const map: McpHeadersMap = {
        '*://*/api/mcp': token,
        'https://api.proone.jp/api/mcp': valid,
      };

      expect(findMcpHeadersForUrl('https://api.proone.jp/api/mcp', map)).toBe(valid);
    });

    test('an exact URL key still wins over an earlier glob pattern', () => {
      const exact = { headers: { Authorization: 'Bearer exact' } };
      const map: McpHeadersMap = {
        'https://*.proone.jp/api/mcp': token,
        'https://api.proone.jp/api/mcp': exact,
      };

      expect(findMcpHeadersForUrl('https://api.proone.jp/api/mcp', map)).toBe(exact);
    });
  });

  test('returns undefined without a headers map', () => {
    expect(findMcpHeadersForUrl('https://api.proone.jp/api/mcp', undefined)).toBeUndefined();
  });
});
