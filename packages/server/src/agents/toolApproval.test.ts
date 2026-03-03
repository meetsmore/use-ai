import { describe, expect, test } from 'bun:test';
import { waitForApproval } from './toolApproval';
import type { ClientSession } from './types';

/**
 * Helper to create a minimal session for testing
 */
function createTestSession(overrides: Partial<ClientSession> = {}): ClientSession {
  return {
    clientId: 'client-1',
    ipAddress: '127.0.0.1',
    socket: {} as never,
    threadId: 'thread-1',
    tools: [],
    state: null,
    pendingToolCalls: new Map(),
    pendingToolApprovals: new Map(),
    ...overrides,
  };
}

describe('waitForApproval', () => {
  test('resolves when client approves', async () => {
    const session = createTestSession({
      abortController: new AbortController(),
    });

    const approvalPromise = waitForApproval(session, 'tool-1');

    // Simulate client approval
    const resolver = session.pendingToolApprovals.get('tool-1');
    expect(resolver).toBeDefined();
    resolver!({ approved: true });

    const result = await approvalPromise;
    expect(result).toEqual({ approved: true });
  });

  test('resolves when client rejects with reason', async () => {
    const session = createTestSession({
      abortController: new AbortController(),
    });

    const approvalPromise = waitForApproval(session, 'tool-1');

    const resolver = session.pendingToolApprovals.get('tool-1');
    resolver!({ approved: false, reason: 'Too dangerous' });

    const result = await approvalPromise;
    expect(result).toEqual({ approved: false, reason: 'Too dangerous' });
  });

  test('rejects when abort signal fires during pending approval', async () => {
    const abortController = new AbortController();
    const session = createTestSession({ abortController });

    const approvalPromise = waitForApproval(session, 'tool-1');

    // Verify approval is pending
    expect(session.pendingToolApprovals.has('tool-1')).toBe(true);

    // Abort the run (simulates client disconnect)
    abortController.abort();

    // Promise should reject
    await expect(approvalPromise).rejects.toThrow('Run aborted');

    // Pending approval should be cleaned up
    expect(session.pendingToolApprovals.has('tool-1')).toBe(false);
  });

  test('rejects immediately when already aborted', async () => {
    const abortController = new AbortController();
    abortController.abort(); // Pre-abort

    const session = createTestSession({ abortController });

    await expect(
      waitForApproval(session, 'tool-1')
    ).rejects.toThrow('Run aborted');

    // Should not have registered a pending approval
    expect(session.pendingToolApprovals.has('tool-1')).toBe(false);
  });

  test('abort listener does not interfere with normal resolution', async () => {
    const abortController = new AbortController();
    const session = createTestSession({ abortController });

    const approvalPromise = waitForApproval(session, 'tool-1');

    // Resolve normally
    const resolver = session.pendingToolApprovals.get('tool-1');
    resolver!({ approved: true });

    const result = await approvalPromise;
    expect(result).toEqual({ approved: true });

    // Aborting after resolution should not cause issues
    abortController.abort();
  });

  test('works without abortController (backward compatibility)', async () => {
    const session = createTestSession(); // No abortController

    const approvalPromise = waitForApproval(session, 'tool-1');

    const resolver = session.pendingToolApprovals.get('tool-1');
    resolver!({ approved: true });

    const result = await approvalPromise;
    expect(result).toEqual({ approved: true });
  });
});
