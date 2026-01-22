import type { FileTransformer, FileTransformerMap } from './types';

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
 * Find the most specific transformer for a MIME type.
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
export function findTransformer(
  mimeType: string,
  transformers: FileTransformerMap | undefined
): FileTransformer | undefined {
  if (!transformers) {
    return undefined;
  }

  let bestMatch: FileTransformer | undefined;
  let bestIsExact = false;
  let bestLength = -1;

  for (const [pattern, transformer] of Object.entries(transformers)) {
    if (!matchesMimeType(mimeType, pattern)) {
      continue;
    }

    const isExact = !pattern.includes('*');

    // Exact match always wins over wildcard
    if (isExact && !bestIsExact) {
      bestMatch = transformer;
      bestIsExact = true;
      bestLength = pattern.length;
      continue;
    }

    // If both are exact or both are wildcard, longer pattern wins
    if (isExact === bestIsExact && pattern.length > bestLength) {
      bestMatch = transformer;
      bestLength = pattern.length;
    }
  }

  return bestMatch;
}
