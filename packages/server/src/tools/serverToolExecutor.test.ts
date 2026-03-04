import { describe, expect, test } from 'bun:test';
import { createServerToolExecutor } from './serverToolExecutor';
import type { ServerToolDefinition, ServerToolContext } from './types';
import type { ClientSession, EventEmitter } from '../agents/types';

/**
 * Helper to create a mock EventEmitter for testing
 */
function createMockEvents(): EventEmitter {
  return {
    emit: () => {},
  } as unknown as EventEmitter;
}

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
    currentRunId: 'run-1',
    ...overrides,
  };
}

function createTestServerTool(
  execute: ServerToolDefinition['_server']['execute'],
  name = 'test_tool'
): ServerToolDefinition {
  return {
    name,
    description: 'Test tool',
    parameters: { type: 'object', properties: {} },
    _server: { execute },
  };
}

describe('createServerToolExecutor', () => {
  test('calls execute with args and context', async () => {
    let capturedArgs: unknown;
    let capturedContext: unknown;

    const tool = createTestServerTool(async (args, context) => {
      capturedArgs = args;
      capturedContext = context;
      return { result: 'ok' };
    });

    const session = createTestSession({ state: { page: 'home' } });
    const executor = createServerToolExecutor(tool, session, createMockEvents());
    const result = await executor({ city: 'Tokyo' }, { toolCallId: 'tc-1' });

    expect(result).toEqual({ result: 'ok' });
    expect(capturedArgs).toEqual({ city: 'Tokyo' });
    expect((capturedContext as ServerToolContext).session).toBe(session);
    expect((capturedContext as ServerToolContext).state).toEqual({ page: 'home' });
    expect((capturedContext as ServerToolContext).runId).toBe('run-1');
    expect((capturedContext as ServerToolContext).toolCallId).toBe('tc-1');
  });

  test('propagates errors from execute function', async () => {
    const tool = createTestServerTool(async () => {
      throw new Error('Database connection failed');
    });

    const session = createTestSession();
    const executor = createServerToolExecutor(tool, session, createMockEvents());

    await expect(
      executor({}, { toolCallId: 'tc-1' })
    ).rejects.toThrow('Database connection failed');
  });

  test('supports synchronous execute functions', async () => {
    const tool = createTestServerTool((args) => {
      return { doubled: (args.value as number) * 2 };
    });

    const session = createTestSession();
    const executor = createServerToolExecutor(tool, session, createMockEvents());
    const result = await executor({ value: 21 }, { toolCallId: 'tc-1' });

    expect(result).toEqual({ doubled: 42 });
  });

  test('uses empty string for runId when currentRunId is undefined', async () => {
    let capturedContext: ServerToolContext | undefined;

    const tool = createTestServerTool(async (_args, context) => {
      capturedContext = context;
      return 'ok';
    });

    const session = createTestSession({ currentRunId: undefined });
    const executor = createServerToolExecutor(tool, session, createMockEvents());
    await executor({}, { toolCallId: 'tc-1' });

    expect(capturedContext!.runId).toBe('');
  });

  test('reads current session state at execution time', async () => {
    let capturedState: unknown;

    const tool = createTestServerTool(async (_args, context) => {
      capturedState = context.state;
      return 'ok';
    });

    const session = createTestSession({ state: { count: 0 } });
    const executor = createServerToolExecutor(tool, session, createMockEvents());

    // Update state after creating executor but before calling it
    session.state = { count: 42 };

    await executor({}, { toolCallId: 'tc-1' });

    expect(capturedState).toEqual({ count: 42 });
  });

  test('does not add to pendingToolCalls (server-side execution)', async () => {
    const tool = createTestServerTool(async () => 'result');

    const session = createTestSession();
    const executor = createServerToolExecutor(tool, session, createMockEvents());
    await executor({}, { toolCallId: 'tc-1' });

    expect(session.pendingToolCalls.size).toBe(0);
  });

  test('provides requestApproval in context', async () => {
    let hasRequestApproval = false;

    const tool = createTestServerTool(async (_args, context) => {
      hasRequestApproval = typeof context.requestApproval === 'function';
      return 'ok';
    });

    const session = createTestSession();
    const executor = createServerToolExecutor(tool, session, createMockEvents());
    await executor({}, { toolCallId: 'tc-1' });

    expect(hasRequestApproval).toBe(true);
  });

  test('requestApproval emits TOOL_APPROVAL_REQUEST event', async () => {
    const emittedEvents: unknown[] = [];
    const mockEvents = {
      emit: (event: unknown) => { emittedEvents.push(event); },
    } as unknown as EventEmitter;

    const tool = createTestServerTool(async (_args, context) => {
      // Start requestApproval but don't await — we'll resolve it via session
      const approvalPromise = context.requestApproval({
        message: 'Confirm production deploy?',
        metadata: { env: 'production' },
      });

      // Simulate client approving after a tick
      setTimeout(() => {
        // Find the approvalId from the emitted event
        const event = emittedEvents[0] as { toolCallId: string };
        const resolver = session.pendingToolApprovals.get(event.toolCallId);
        resolver?.({ approved: true });
      }, 10);

      return approvalPromise;
    });

    const session = createTestSession();
    const executor = createServerToolExecutor(tool, session, mockEvents);
    const result = await executor({}, { toolCallId: 'tc-1' });

    expect(result).toEqual({ approved: true });
    expect(emittedEvents.length).toBe(1);

    const event = emittedEvents[0] as Record<string, unknown>;
    expect(event.type).toBe('TOOL_APPROVAL_REQUEST');
    expect(event.toolCallName).toBe('test_tool');
    expect(event.message).toBe('Confirm production deploy?');
    expect(event.metadata).toEqual({ env: 'production' });
    expect((event.toolCallId as string).startsWith('tc-1-approval-')).toBe(true);
  });

  test('requestApproval resolves with rejection when user rejects', async () => {
    const emittedEvents: unknown[] = [];
    const mockEvents = {
      emit: (event: unknown) => { emittedEvents.push(event); },
    } as unknown as EventEmitter;

    const tool = createTestServerTool(async (_args, context) => {
      const approvalPromise = context.requestApproval({
        message: 'Delete all data?',
      });

      setTimeout(() => {
        const event = emittedEvents[0] as { toolCallId: string };
        const resolver = session.pendingToolApprovals.get(event.toolCallId);
        resolver?.({ approved: false, reason: 'Too dangerous' });
      }, 10);

      return approvalPromise;
    });

    const session = createTestSession();
    const executor = createServerToolExecutor(tool, session, mockEvents);
    const result = await executor({}, { toolCallId: 'tc-2' });

    expect(result).toEqual({ approved: false, reason: 'Too dangerous' });
  });
});
