import { describe, test, expect, spyOn } from 'bun:test';
import type { McpHeadersMap } from '@meetsmore-oss/use-ai-core';
import { findMcpHeadersForUrl } from './mcpHeaderPatterns';
import { logger } from '../logger';

/** Returns true if findMcpHeadersForUrl ignores the pattern as invalid and logs a warning. */
function isRejected(pattern: string): boolean {
  const warnSpy = spyOn(logger, 'warn');
  try {
    findMcpHeadersForUrl('https://unrelated.example.org/mcp', { [pattern]: { headers: {} } });
    return warnSpy.mock.calls.length > 0;
  } finally {
    warnSpy.mockRestore();
  }
}

describe('mcpHeaders pattern validation', () => {
  describe('accepts a pattern with a domain', () => {
    test.each([
      ['literal host', 'https://api.example.com/api/mcp'],
      ['literal host without a path', 'https://api.example.com'],
      ['localhost', 'http://localhost/mcp'],
      ['localhost with a port', 'http://localhost:3030/mcp'],
      ['IPv4 literal with a port', 'http://127.0.0.1:8080/mcp'],
      ['IPv6 literal with a port', 'http://[::1]:3000/mcp'],
      ['leading *. before a registrable domain', 'https://*.example.com/api/mcp'],
      ['leading *. before a subdomain', 'https://*.api.example.com/mcp'],
      ['*. form with a port', 'https://*.example.com:8443/mcp'],
      ['scheme glob', '*://api.example.com/api/mcp'],
      ['scheme brace glob', '{http,https}://api.example.com/api/mcp'],
      ['path glob', 'https://api.example.com/**'],
      ['*. before a PSL exception domain (city.kawasaki.jp)', 'https://*.city.kawasaki.jp/api/mcp'],
      ['*. before a domain under a PSL wildcard suffix', 'https://*.foo.bar.kawasaki.jp/api/mcp'],
    ])('%s: %s', (_name, pattern) => {
      expect(isRejected(pattern)).toBe(false);
    });
  });

  describe('rejects a pattern without a domain', () => {
    test.each([
      ['wildcard host for any scheme', '*://*/api/mcp'],
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
      ['wildcard in the middle of a label', 'https://api*.example.com/api/mcp'],
      ['wildcard label in the middle', 'https://a.*.example.com/api/mcp'],
      ['two wildcard labels', 'https://*.*.example.com/api/mcp'],
      ['globstar label', 'https://**.example.com/api/mcp'],
      ['question mark in host', 'https://api.example.?om/api/mcp'],
      ['character class in host', 'https://[a-z].example.com/api/mcp'],
      ['brace in host', 'https://{a,b}.example.com/api/mcp'],
      ['wildcard port', 'https://api.example.com:*/api/mcp'],
      ['partial wildcard port', 'https://api.example.com:80*/api/mcp'],
      ['port out of range', 'https://api.example.com:70000/api/mcp'],
      ['user info', 'https://user@api.example.com/api/mcp'],
      ['empty host', 'https:///api/mcp'],
      ['no scheme', 'api.example.com/api/mcp'],
      ['bare wildcard', '*'],
      ['empty string', ''],
    ])('%s: %s', (_name, pattern) => {
      expect(isRejected(pattern)).toBe(true);
    });
  });
});

describe('findMcpHeadersForUrl', () => {
  const token = { headers: { Authorization: 'Bearer user-jwt' } };

  const matches = (url: string, pattern: string) =>
    findMcpHeadersForUrl(url, { [pattern]: token }) !== undefined;

  describe('*. host form', () => {
    const pattern = 'https://*.example.com/api/mcp';

    test('matches a direct subdomain', () => {
      expect(matches('https://a.example.com/api/mcp', pattern)).toBe(true);
    });

    test('matches a subdomain at any depth', () => {
      expect(matches('https://a.b.example.com/api/mcp', pattern)).toBe(true);
    });

    test('does not match the apex domain', () => {
      expect(matches('https://example.com/api/mcp', pattern)).toBe(false);
    });

    test('does not match a domain that only ends with the same text', () => {
      expect(matches('https://evilexample.com/api/mcp', pattern)).toBe(false);
    });

    test('does not match a domain that contains the domain as a label', () => {
      expect(matches('https://example.com.evil.com/api/mcp', pattern)).toBe(false);
    });
  });

  describe('literal host', () => {
    test('matches the same host, ignoring case', () => {
      expect(matches('https://api.example.com/api/mcp', 'https://API.example.com/api/mcp')).toBe(true);
    });

    test('does not match a subdomain', () => {
      expect(matches('https://x.api.example.com/api/mcp', 'https://api.example.com/api/mcp')).toBe(false);
    });

    test('without a path, matches only the root path', () => {
      expect(matches('https://api.example.com/', 'https://api.example.com')).toBe(true);
      expect(matches('https://api.example.com/api/mcp', 'https://api.example.com')).toBe(false);
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
      expect(matches('https://api.example.com/mcp', 'https://api.example.com:443/mcp')).toBe(true);
    });
  });

  describe('scheme and path globs', () => {
    test('scheme glob matches http and https', () => {
      expect(matches('https://api.example.com/api/mcp', '*://api.example.com/api/mcp')).toBe(true);
      expect(matches('http://api.example.com/api/mcp', '*://api.example.com/api/mcp')).toBe(true);
    });

    test('scheme must match', () => {
      expect(matches('http://api.example.com/api/mcp', 'https://api.example.com/api/mcp')).toBe(false);
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
        const result = findMcpHeadersForUrl('https://api.example.com/api/mcp', {
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
        'https://api.example.com/api/mcp': valid,
      };

      expect(findMcpHeadersForUrl('https://api.example.com/api/mcp', map)).toBe(valid);
    });

    test('an exact URL key still wins over an earlier glob pattern', () => {
      const exact = { headers: { Authorization: 'Bearer exact' } };
      const map: McpHeadersMap = {
        'https://*.example.com/api/mcp': token,
        'https://api.example.com/api/mcp': exact,
      };

      expect(findMcpHeadersForUrl('https://api.example.com/api/mcp', map)).toBe(exact);
    });
  });

  test('returns undefined without a headers map', () => {
    expect(findMcpHeadersForUrl('https://api.example.com/api/mcp', undefined)).toBeUndefined();
  });
});
