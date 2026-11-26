import { describe, test, expect } from 'bun:test';
import { matchesPattern } from './patternMatcher';

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

  describe('Edge cases and special scenarios', () => {
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
