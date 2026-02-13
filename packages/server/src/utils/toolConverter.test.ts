import { describe, expect, test } from 'bun:test';
import { createClientToolExecutor } from './toolConverter';
import type { ClientSession } from '../agents/types';

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
    conversationHistory: [],
    pendingToolCalls: new Map(),
    pendingToolApprovals: new Map(),
    ...overrides,
  };
}

describe('createClientToolExecutor', () => {
  test('resolves when client sends result', async () => {
    const session = createTestSession({
      abortController: new AbortController(),
    });
    const executor = createClientToolExecutor(session);

    const resultPromise = executor({ value: 'test' }, { toolCallId: 'tool-1' });

    // Simulate client sending result
    const resolver = session.pendingToolCalls.get('tool-1');
    expect(resolver).toBeDefined();
    resolver!(JSON.stringify({ success: true }));

    const result = await resultPromise;
    expect(result).toEqual({ success: true });
  });

  test('rejects when abort signal fires during pending tool call', async () => {
    const abortController = new AbortController();
    const session = createTestSession({ abortController });
    const executor = createClientToolExecutor(session);

    const resultPromise = executor({ value: 'test' }, { toolCallId: 'tool-1' });

    // Verify tool call is pending
    expect(session.pendingToolCalls.has('tool-1')).toBe(true);

    // Abort the run (simulates client disconnect)
    abortController.abort();

    // Promise should reject
    await expect(resultPromise).rejects.toThrow('Run aborted');

    // Pending tool call should be cleaned up
    expect(session.pendingToolCalls.has('tool-1')).toBe(false);
  });

  test('rejects immediately when already aborted', async () => {
    const abortController = new AbortController();
    abortController.abort(); // Pre-abort

    const session = createTestSession({ abortController });
    const executor = createClientToolExecutor(session);

    await expect(
      executor({ value: 'test' }, { toolCallId: 'tool-1' })
    ).rejects.toThrow('Run aborted');

    // Should not have registered a pending tool call
    expect(session.pendingToolCalls.has('tool-1')).toBe(false);
  });

  test('abort listener does not interfere with normal resolution', async () => {
    const abortController = new AbortController();
    const session = createTestSession({ abortController });
    const executor = createClientToolExecutor(session);

    const resultPromise = executor({ value: 'test' }, { toolCallId: 'tool-1' });

    // Resolve normally
    const resolver = session.pendingToolCalls.get('tool-1');
    resolver!(JSON.stringify({ data: 'hello' }));

    const result = await resultPromise;
    expect(result).toEqual({ data: 'hello' });

    // Aborting after resolution should not cause issues
    abortController.abort();
  });

  test('works without abortController (backward compatibility)', async () => {
    const session = createTestSession(); // No abortController
    const executor = createClientToolExecutor(session);

    const resultPromise = executor({ value: 'test' }, { toolCallId: 'tool-1' });

    const resolver = session.pendingToolCalls.get('tool-1');
    resolver!(JSON.stringify({ ok: true }));

    const result = await resultPromise;
    expect(result).toEqual({ ok: true });
  });
});
