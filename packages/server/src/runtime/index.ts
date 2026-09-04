import type { RuntimeAdapter, RuntimeType } from './types';
import { detectRuntime } from './detection';

// Re-export types
export type {
  RuntimeAdapter,
  RuntimeType,
  RuntimeServerConfig,
  RuntimeServerHandle,
  RawWebSocket,
  RuntimeListener,
} from './types';
export { detectRuntime } from './detection';
export { createClientIpTracker, type ClientIpTracker, type ClientIpConnection } from './clientIp';

/**
 * Creates a runtime adapter for the specified or detected runtime.
 *
 * @param runtime - The runtime to use: 'auto' (detect), 'bun', or 'node'
 * @returns The appropriate RuntimeAdapter for the runtime
 * @throws Error if 'bun' runtime is requested but running on Node.js
 *
 * Note: Node.js runtime works on Bun due to Bun's Node.js compatibility layer,
 * so `runtime: 'node'` is allowed when running on Bun.
 * However, WebSocket connections may not work correctly with the Node adapter on Bun.
 */
export function createRuntimeAdapter(runtime: 'auto' | RuntimeType = 'auto'): RuntimeAdapter {
  const detected = detectRuntime();
  const target = runtime === 'auto' ? detected : runtime;

  // Only error when requesting Bun runtime on Node.js
  // Node.js runtime works on Bun due to compatibility layer
  if (runtime === 'bun' && detected === 'node') {
    throw new Error('Cannot use Bun runtime adapter on Node.js');
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
