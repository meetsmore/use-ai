import { describe, expect, test } from 'bun:test';
import { waitForApproval, createApprovalWrapper, type ToolArguments } from './toolApproval';
import { abortRun, RunAbortedByUser, RunAbortedByClientDisconnect } from '../utils/abortReason';
import type { ClientSession, EventEmitter } from './types';
import type { ToolDefinition } from '../types';
import type { ServerToolDefinition } from '../tools/types';
import type { RemoteToolDefinition } from '../mcp';

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

  test('surfaces the abort cause in the rejection message (user stop)', async () => {
    const abortController = new AbortController();
    const session = createTestSession({ abortController });

    const approvalPromise = waitForApproval(session, 'tool-1');
    expect(session.pendingToolApprovals.has('tool-1')).toBe(true);

    abortRun(abortController, new RunAbortedByUser());

    await expect(approvalPromise).rejects.toThrow('Run aborted by user');
  });

  test('surfaces the abort cause when already aborted (client disconnect)', async () => {
    const abortController = new AbortController();
    abortRun(abortController, new RunAbortedByClientDisconnect()); // Pre-abort with cause

    const session = createTestSession({ abortController });

    await expect(
      waitForApproval(session, 'tool-1')
    ).rejects.toThrow('Run aborted by client disconnect');
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

describe('createApprovalWrapper with modifiedArgs', () => {
  const parameters: ToolDefinition['parameters'] = {
    type: 'object',
    properties: { title: { type: 'string' }, count: { type: 'number' } },
    required: ['title'],
  };
  const annotations = { destructiveHint: true };

  const serverTool: ServerToolDefinition = {
    name: 'create_item',
    description: 'Create an item',
    parameters,
    annotations,
    _server: { execute: async () => ({ ok: true }) },
  };

  const remoteTool: RemoteToolDefinition = {
    name: 'ns_create_item',
    description: 'Create an item',
    parameters,
    _remote: {
      provider: {} as RemoteToolDefinition['_remote']['provider'],
      originalName: 'create_item',
      annotations,
    },
  };

  const clientTool: ToolDefinition = {
    name: 'create_item',
    description: 'Create an item',
    parameters,
    annotations,
  };

  function setup(toolDef: ToolDefinition) {
    const session = createTestSession({ abortController: new AbortController() });
    const events: EventEmitter = { emit: () => {} };
    const calls: ToolArguments[] = [];
    const execute = createApprovalWrapper(toolDef, session, events, async (args) => {
      calls.push(args);
      return { ok: true };
    });
    return { session, calls, execute };
  }

  const originalArgs = { title: 'Original', count: 1 };

  test('runs with the original args when the approval carries no modifiedArgs', async () => {
    const { session, calls, execute } = setup(serverTool);
    const promise = execute(originalArgs, { toolCallId: 'tc-1' });
    session.pendingToolApprovals.get('tc-1')!({ approved: true });

    expect(await promise).toEqual({ ok: true });
    expect(calls).toEqual([originalArgs]);
  });

  test('runs a server tool with valid modifiedArgs instead of the original args', async () => {
    const { session, calls, execute } = setup(serverTool);
    const promise = execute(originalArgs, { toolCallId: 'tc-1' });
    session.pendingToolApprovals.get('tc-1')!({ approved: true, modifiedArgs: { title: 'Edited', count: 2 } });

    expect(await promise).toEqual({ ok: true });
    expect(calls).toEqual([{ title: 'Edited', count: 2 }]);
  });

  test('runs an MCP tool with valid modifiedArgs instead of the original args', async () => {
    const { session, calls, execute } = setup(remoteTool);
    const promise = execute(originalArgs, { toolCallId: 'tc-1' });
    session.pendingToolApprovals.get('tc-1')!({ approved: true, modifiedArgs: { title: 'Edited' } });

    await promise;
    expect(calls).toEqual([{ title: 'Edited' }]);
  });

  test('does not run a server tool when modifiedArgs fail its input schema', async () => {
    const { session, calls, execute } = setup(serverTool);
    const promise = execute(originalArgs, { toolCallId: 'tc-1' });
    session.pendingToolApprovals.get('tc-1')!({ approved: true, modifiedArgs: { count: 'two' } });

    const result = await promise as { error: boolean; message: string };
    expect(calls).toEqual([]);
    expect(result.error).toBe(true);
    expect(result.message).toContain('Edited arguments are invalid');
    expect(result.message).toContain("must have required property 'title'");
    expect(result.message).toContain('args/count must be number');
  });

  test('does not run an MCP tool when modifiedArgs fail its input schema', async () => {
    const { session, calls, execute } = setup(remoteTool);
    const promise = execute(originalArgs, { toolCallId: 'tc-1' });
    session.pendingToolApprovals.get('tc-1')!({ approved: true, modifiedArgs: { title: 42 } });

    const result = await promise as { error: boolean; message: string };
    expect(calls).toEqual([]);
    expect(result.error).toBe(true);
    expect(result.message).toContain('args/title must be string');
  });

  test('passes modifiedArgs of a client tool through, since the client executes and validates it', async () => {
    const { session, calls, execute } = setup(clientTool);
    const promise = execute(originalArgs, { toolCallId: 'tc-1' });
    session.pendingToolApprovals.get('tc-1')!({ approved: true, modifiedArgs: { title: 'Edited' } });

    await promise;
    expect(calls).toEqual([{ title: 'Edited' }]);
  });
});
