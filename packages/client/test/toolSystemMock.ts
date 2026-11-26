import { mock } from 'bun:test';
import type { UseToolSystemReturn } from '../src/hooks/useToolSystem';

/**
 * Creates a stub tool system for `useServerEvents` tests.
 * Each function is a `mock()`. The tool registry is empty.
 * Fields in `overrides` replace the stub fields.
 */
export function makeToolSystem(overrides: Partial<UseToolSystemReturn> = {}): UseToolSystemReturn {
  return {
    registerTools: mock(),
    unregisterTools: mock(),
    isInvisible: mock(() => false),
    aggregatedTools: {},
    hasTools: false,
    aggregatedToolsRef: { current: {} },
    signalReady: mock(),
    toolRegistryVersion: 0,
    registerWaiter: mock(),
    unregisterWaiter: mock(),
    pendingApprovals: [],
    handleApprovalRequest: mock(),
    executeToolCall: mock(async () => undefined),
    storePendingToolCall: mock(),
    approveAll: mock(async () => undefined),
    rejectAll: mock(),
    endRun: mock(),
    ...overrides,
  } as unknown as UseToolSystemReturn;
}
