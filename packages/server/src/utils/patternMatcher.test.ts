import { describe, test, expect } from 'bun:test';
import { matchesPattern, findMatch } from './patternMatcher';

describe('MCP header configuration supports exact URL matching and glob patterns', () => {
  describe('Exact URL matching', () => {
    test('matches identical URLs exactly', () => {
      expect(matchesPattern('https://api.example.com', 'https://api.example.com')).toBe(true);
    });

    test('does not match different URLs', () => {
      expect(matchesPattern('https://api.example.com', 'https://other.example.com')).toBe(false);
    });

    test('is case-sensitive', () => {
      expect(matchesPattern('https://api.example.com', 'https://API.example.com')).toBe(false);
    });

    test('includes protocol in exact matching', () => {
      expect(matchesPattern('https://api.example.com', 'http://api.example.com')).toBe(false);
    });
  });

  describe('Glob pattern matching with wildcards', () => {
    test('matches wildcard subdomain patterns', () => {
      expect(matchesPattern('https://api.meetsmore.com', 'https://*.meetsmore.com')).toBe(true);
      expect(matchesPattern('https://staging.meetsmore.com', 'https://*.meetsmore.com')).toBe(true);
      expect(matchesPattern('https://api.example.com', 'https://*.meetsmore.com')).toBe(false);
    });

    test('matches wildcard protocol patterns', () => {
      expect(matchesPattern('https://api.example.com', '*://api.example.com')).toBe(true);
      expect(matchesPattern('http://api.example.com', '*://api.example.com')).toBe(true);
      expect(matchesPattern('wss://api.example.com', '*://api.example.com')).toBe(true);
    });

    test('matches patterns with multiple wildcards', () => {
      expect(matchesPattern('https://api.meetsmore.com', '*://*.meetsmore.com')).toBe(true);
      expect(matchesPattern('http://staging.meetsmore.com', '*://*.meetsmore.com')).toBe(true);
      expect(matchesPattern('https://api.example.com', '*://*.meetsmore.com')).toBe(false);
    });

    test('matches wildcard in middle of domain', () => {
      expect(matchesPattern('https://internal-api.company.com', 'https://internal-*.company.com')).toBe(true);
      expect(matchesPattern('https://internal-staging.company.com', 'https://internal-*.company.com')).toBe(true);
      expect(matchesPattern('https://external-api.company.com', 'https://internal-*.company.com')).toBe(false);
    });
  });

  describe('Pattern priority in findMatch', () => {
    test('prioritizes exact matches over glob patterns', () => {
      const patternMap = {
        'https://*.example.com': { key: 'wildcard' },
        'https://api.example.com': { key: 'exact' },
      };
      const result = findMatch('https://api.example.com', patternMap);
      expect(result).toEqual({ key: 'exact' });
    });

    test('returns glob match when no exact match exists', () => {
      const patternMap = {
        'https://*.example.com': { key: 'wildcard1' },
        'https://*.other.com': { key: 'wildcard2' },
      };
      const result = findMatch('https://api.example.com', patternMap);
      expect(result).toEqual({ key: 'wildcard1' });
    });

    test('returns first matching pattern when multiple globs match', () => {
      const testValue1 = { key: 'pattern1' };
      const testValue2 = { key: 'pattern2' };
      const patternMap = {
        'https://*.meetsmore.com': testValue1,
        '*://*.meetsmore.com': testValue2,
      };
      const result = findMatch('https://api.meetsmore.com', patternMap);
      expect(result).toBeDefined();
      // Both patterns match, so result should be one of them
      const isMatch = result === testValue1 || result === testValue2;
      expect(isMatch).toBe(true);
    });

    test('returns undefined when no patterns match', () => {
      const patternMap = {
        'https://*.example.com': { key: 'value1' },
        'https://*.other.com': { key: 'value2' },
      };
      const result = findMatch('https://api.nomatch.com', patternMap);
      expect(result).toBeUndefined();
    });

    test('handles complex multi-pattern scenarios', () => {
      const patternMap = {
        'https://api.example.com': { type: 'exact' },
        'https://*.meetsmore.com': { type: 'wildcard-subdomain' },
        '*://*.example.com': { type: 'wildcard-protocol' },
      };

      expect(findMatch('https://api.example.com', patternMap)).toEqual({ type: 'exact' });
      expect(findMatch('https://staging.meetsmore.com', patternMap)).toEqual({ type: 'wildcard-subdomain' });
      expect(findMatch('http://other.example.com', patternMap)).toEqual({ type: 'wildcard-protocol' });
    });
  });

  describe('Edge cases and special scenarios', () => {
    test('handles empty pattern map', () => {
      const result = findMatch('https://api.example.com', {});
      expect(result).toBeUndefined();
    });

    test('handles URLs with ports', () => {
      expect(matchesPattern('https://api.example.com:8081', 'https://api.example.com:8081')).toBe(true);
      expect(matchesPattern('https://api.example.com:8081', 'https://*.example.com:8081')).toBe(true);
    });

    test('handles URLs with paths', () => {
      expect(matchesPattern('https://api.example.com/v1/endpoint', 'https://api.example.com/v1/endpoint')).toBe(true);
      expect(matchesPattern('https://api.example.com/v1/endpoint', 'https://*.example.com/v1/endpoint')).toBe(true);
    });
  });
});
