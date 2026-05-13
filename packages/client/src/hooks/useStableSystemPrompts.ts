import { useRef } from 'react';
import type { SystemPromptEntry } from '../types';

/**
 * Creates a stable systemPrompts reference, even when callers pass inline arrays.
 *
 * Mirrors the spirit of {@link useStableTools}: callers do NOT need to wrap their
 * `systemPrompts` in `useMemo`. The returned reference stays stable as long as
 * the array's contents (content, providerOptions) are unchanged.
 *
 * @param systemPrompts - The systemPrompts array from the user (potentially unstable references)
 * @returns Stable reference that only changes when the contents actually change
 *
 * @example
 * ```typescript
 * // Inline systemPrompts no longer trigger unnecessary re-sends.
 * <UseAIProvider
 *   serverUrl="..."
 *   systemPrompts={[{ content: 'You are helpful' }]}
 * >
 *   <App />
 * </UseAIProvider>
 * ```
 */
export function useStableSystemPrompts(
  systemPrompts: SystemPromptEntry[] | undefined,
): SystemPromptEntry[] | undefined {
  const stableRef = useRef<SystemPromptEntry[] | undefined>(undefined);
  const prevKeyRef = useRef<string>('');

  // Normalize "no system prompts": undefined or empty array.
  if (!systemPrompts || systemPrompts.length === 0) {
    stableRef.current = undefined;
    prevKeyRef.current = '';
    return undefined;
  }

  // Content-based equality. systemPrompts arrays are typically small (1-3 entries)
  // and stringify-safe (plain JSON), so the cost is negligible.
  const currentKey = JSON.stringify(systemPrompts);

  if (currentKey !== prevKeyRef.current) {
    prevKeyRef.current = currentKey;
    stableRef.current = systemPrompts;
  }

  return stableRef.current;
}
