import type { FileTransformerMap } from './types';

/**
 * Check if a MIME type matches a pattern.
 * Supports exact match and wildcard patterns ending with '*'.
 *
 * Examples:
 * - 'application/pdf' matches 'application/pdf' (exact)
 * - 'image/png' matches 'image/*' (partial wildcard)
 * - 'text/plain' matches '*' (global wildcard)
 * - 'text/plain' matches '*\/*' (global wildcard)
 */
export function matchesMimeType(mimeType: string, pattern: string): boolean {
  // Exact match
  if (!pattern.includes('*')) {
    return mimeType === pattern;
  }

  // Wildcard match: convert pattern to regex
  // 'image/*' -> /^image\/.*$/
  // '*' -> /^.*$/
  // '*/*' -> /^.*\/.*$/
  const regexPattern = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape regex special chars (except *)
    .replace(/\*/g, '.*'); // Convert * to .*
  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(mimeType);
}

/**
 * Find the most specific transformer pattern key for a MIME type.
 * Returns the pattern string (e.g., 'application/pdf', 'image/*') or undefined.
 *
 * Specificity rules:
 * 1. Exact match (no wildcard) always wins
 * 2. Among wildcard patterns, longer pattern = more specific
 *
 * Example for 'image/png':
 * - 'image/png' (exact, wins)
 * - 'image/*' (length 7, second)
 * - '*' (length 1, last)
 */
export function findTransformerPattern(
  mimeType: string,
  transformers: FileTransformerMap | undefined
): string | undefined {
  if (!transformers) {
    return undefined;
  }

  let bestKey: string | undefined;
  let bestIsExact = false;
  let bestLength = -1;

  for (const pattern of Object.keys(transformers)) {
    if (!matchesMimeType(mimeType, pattern)) {
      continue;
    }

    const isExact = !pattern.includes('*');

    // Exact match always wins over wildcard
    if (isExact && !bestIsExact) {
      bestKey = pattern;
      bestIsExact = true;
      bestLength = pattern.length;
      continue;
    }

    // If both are exact or both are wildcard, longer pattern wins
    if (isExact === bestIsExact && pattern.length > bestLength) {
      bestKey = pattern;
      bestLength = pattern.length;
    }
  }

  return bestKey;
}
