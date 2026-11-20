/**
 * Debug logging for the use-ai client.
 *
 * Debug logs can contain user data: tool arguments, workflow inputs, chat IDs and
 * server config. On a shared machine, anyone who opens DevTools can read them.
 * For this reason, debug logs are off by default.
 *
 * Turn them on with one of these:
 * - the `debug` prop on `UseAIProvider`
 * - `setDebugLogging(true)` (for example, when you use `UseAIClient` without the provider)
 * - `localStorage.setItem('use-ai:debug', 'true')` in the browser console
 *
 * Warnings and errors do not go through this logger. They must not contain user data,
 * such as tool arguments, workflow inputs or message content.
 */

/** The localStorage key that turns on debug logs when its value is `'true'`. */
export const DEBUG_STORAGE_KEY = 'use-ai:debug';

let debugEnabled = false;

/**
 * Turns debug logs on or off for all use-ai clients on the page.
 * The localStorage flag turns them on also, even when this is `false`.
 */
export function setDebugLogging(enabled: boolean): void {
  debugEnabled = enabled;
}

/** Returns `true` when debug logs are on. */
export function isDebugLoggingEnabled(): boolean {
  if (debugEnabled) return true;
  try {
    return globalThis.localStorage?.getItem(DEBUG_STORAGE_KEY) === 'true';
  } catch {
    // localStorage can throw (for example, when site data is blocked).
    return false;
  }
}

export const logger = {
  /** Writes to `console.log` only when debug logs are on. */
  debug(...args: unknown[]): void {
    if (isDebugLoggingEnabled()) console.log(...args);
  },
};
