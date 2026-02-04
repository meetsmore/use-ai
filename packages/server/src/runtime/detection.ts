import type { RuntimeType } from './types';

/**
 * Detects the current JavaScript runtime environment.
 *
 * @returns 'bun' if running in Bun, 'node' otherwise
 */
export function detectRuntime(): RuntimeType {
  // Check for Bun global
  if (typeof globalThis !== 'undefined' && 'Bun' in globalThis) {
    return 'bun';
  }
  return 'node';
}
