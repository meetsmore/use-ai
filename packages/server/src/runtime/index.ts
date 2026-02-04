import type { RuntimeAdapter, RuntimeType } from './types';
import { detectRuntime } from './detection';

// Re-export types
export type {
  RuntimeAdapter,
  RuntimeType,
  RuntimeServerConfig,
  RuntimeServerHandle,
  ConnectionContext,
} from './types';
export { detectRuntime } from './detection';
export { BaseRuntimeAdapter } from './BaseRuntimeAdapter';
export { getAllowedOrigin, resolveCorsHeaders, resolvePreflightHeaders } from './cors';

/**
 * Creates a runtime adapter for the specified or detected runtime.
 *
 * @param runtime - The runtime to use: 'auto' (detect), 'bun', or 'node'
 * @returns The appropriate RuntimeAdapter for the runtime
 * @throws Error if the specified runtime doesn't match the actual runtime
 */
export function createRuntimeAdapter(runtime: 'auto' | RuntimeType = 'auto'): RuntimeAdapter {
  const detected = detectRuntime();
  const target = runtime === 'auto' ? detected : runtime;

  // Validate that requested runtime matches detected runtime
  if (runtime !== 'auto' && runtime !== detected) {
    throw new Error(
      `Runtime mismatch: requested '${runtime}' but running on '${detected}'`
    );
  }

  if (target === 'bun') {
    // Dynamic import to avoid loading Bun-specific code in Node.js
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { BunRuntimeAdapter } = require('./bun');
    return new BunRuntimeAdapter();
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { NodeRuntimeAdapter } = require('./node');
    return new NodeRuntimeAdapter();
  }
}
