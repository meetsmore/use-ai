/**
 * Generic utility for matching strings against patterns using picomatch.
 *
 * Supported pattern types:
 * 1. **Constant strings** - Exact match
 * 2. **Glob patterns** - Wildcard matching (via picomatch)
 *
 * @example
 * ```typescript
 * // Constant
 * matchesPattern('https://api.example.com', 'https://api.example.com')
 *
 * // Glob with wildcards
 * matchesPattern('https://api.meetsmore.com', 'https://*.meetsmore.com')
 * matchesPattern('https://api.example.com', '*://*.example.com')
 * ```
 */

import picomatch from 'picomatch';

/**
 * Matches a string against a pattern (constant string or glob).
 */
export function matchesPattern(str: string, pattern: string): boolean {
  // Exact match
  if (str === pattern) return true;

  // Glob pattern (picomatch handles exact strings too)
  return picomatch(pattern)(str);
}

/**
 * Finds the first matching pattern and its value from a pattern map.
 * Exact string matches have priority over glob patterns.
 *
 * @param str - The string to match against patterns
 * @param patternMap - A map of patterns to values
 * @returns The value for the first matching pattern, or undefined if no match
 *
 * @example
 * ```typescript
 * const config = {
 *   'https://api.example.com': { key: 'exact' },
 *   'https://*.example.com': { key: 'wildcard' }
 * };
 * findMatch('https://api.example.com', config); // { key: 'exact' }
 * findMatch('https://other.example.com', config); // { key: 'wildcard' }
 * ```
 */
export function findMatch<T>(
  str: string,
  patternMap: Record<string, T>
): T | undefined {
  const patterns = Object.keys(patternMap);

  // First pass: exact string match (highest priority)
  if (patterns.includes(str)) {
    return patternMap[str];
  }

  // Second pass: glob pattern matching
  for (const pattern of patterns) {
    if (matchesPattern(str, pattern)) {
      return patternMap[pattern];
    }
  }

  return undefined;
}
