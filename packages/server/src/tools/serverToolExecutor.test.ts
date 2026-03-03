import { describe, expect, test } from 'bun:test';
import { createServerToolExecutor } from './serverToolExecutor';
import type { ServerToolDefinition, ServerToolContext } from './types';
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
    const executor = createServerToolExecutor(tool, session);
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
    const executor = createServerToolExecutor(tool, session);

    await expect(
      executor({}, { toolCallId: 'tc-1' })
    ).rejects.toThrow('Database connection failed');
  });

  test('supports synchronous execute functions', async () => {
    const tool = createTestServerTool((args) => {
      return { doubled: (args.value as number) * 2 };
    });

    const session = createTestSession();
    const executor = createServerToolExecutor(tool, session);
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
    const executor = createServerToolExecutor(tool, session);
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
    const executor = createServerToolExecutor(tool, session);

    // Update state after creating executor but before calling it
    session.state = { count: 42 };

    await executor({}, { toolCallId: 'tc-1' });

    expect(capturedState).toEqual({ count: 42 });
  });

  test('does not add to pendingToolCalls (server-side execution)', async () => {
    const tool = createTestServerTool(async () => 'result');

    const session = createTestSession();
    const executor = createServerToolExecutor(tool, session);
    await executor({}, { toolCallId: 'tc-1' });

    expect(session.pendingToolCalls.size).toBe(0);
  });
});
