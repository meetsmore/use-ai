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
