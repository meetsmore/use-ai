import { describe, expect, test, afterAll } from 'bun:test';
import { z } from 'zod';
import { UseAIServer } from '../server';
import { AISDKAgent } from './AISDKAgent';
import { createServerToolExecutor, defineServerTool } from '../tools';
import { createSequentialMockModel } from '../../test/integration-test-utils';
import { waitForApproval, createApprovalWrapper, type ToolArguments } from './toolApproval';
import { abortRun, RunAbortedByUser, RunAbortedByClientDisconnect } from '../utils/abortReason';
import { isServerTool } from '../utils/toolFilters';
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
      inputSchema: parameters,
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

describe('createApprovalWrapper modifiedArgs validation by tool kind', () => {
  function run(toolDef: ToolDefinition, modifiedArgs: Record<string, unknown>) {
    const session = createTestSession({ abortController: new AbortController() });
    const events: EventEmitter = { emit: () => {} };
    const calls: ToolArguments[] = [];
    const captureArgs = async (args: ToolArguments) => {
      calls.push(args);
      return { ok: true };
    };
    const baseExecutor = isServerTool(toolDef)
      ? createServerToolExecutor({ ...toolDef, _server: { ...toolDef._server, execute: captureArgs } }, session, events)
      : captureArgs;
    const execute = createApprovalWrapper(toolDef, session, events, baseExecutor);
    const promise = execute({}, { toolCallId: 'tc-1' });
    session.pendingToolApprovals.get('tc-1')!({ approved: true, modifiedArgs });
    return promise.then((result) => ({ result: result as { error?: boolean; message?: string }, calls }));
  }

  function serverToolFrom(schema: z.ZodType): ServerToolDefinition {
    const server = new UseAIServer({
      port: 19021 + serversToClose.length,
      agents: { test: new AISDKAgent({ hooks: { loadConfig: () => ({ model: createSequentialMockModel([{ text: 'OK' }]) }) } }) },
      defaultAgent: 'test',
      tools: {
        edit_item: defineServerTool('Edit an item', schema, async () => ({ ok: true }), {
          annotations: { destructiveHint: true },
        }),
      },
    });
    serversToClose.push(server);
    return (server as unknown as { serverTools: ServerToolDefinition[] }).serverTools[0];
  }

  const serversToClose: UseAIServer[] = [];
  afterAll(async () => {
    await Promise.all(serversToClose.map((server) => server.close()));
  });

  test('runs a defineServerTool tool with an edit inside exclusive numeric bounds', async () => {
    const tool = serverToolFrom(z.object({ amount: z.number().positive().lt(100) }));
    const { result, calls } = await run(tool, { amount: 5 });
    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([{ amount: 5 }]);
  });

  test('parses edited arguments once with the server tool’s async Zod schema', async () => {
    let parses = 0;
    const tool = serverToolFrom(z.object({ title: z.string().transform(async (value) => {
      parses += 1;
      return value.trim();
    }) }));

    const { result, calls } = await run(tool, { title: ' Edited ' });

    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([{ title: 'Edited' }]);
    expect(parses).toBe(1);
  });

  test('denies a defineServerTool edit that fails a Zod refinement, naming the field', async () => {
    const tool = serverToolFrom(
      z.object({ code: z.string().refine((value) => value.startsWith('A'), 'must start with A') })
    );
    const { result, calls } = await run(tool, { code: 'B1' });
    expect(calls).toEqual([]);
    expect(result.error).toBe(true);
    expect(result.message).toContain('args/code must start with A');
  });

  test('runs an MCP tool with an edit that matches $defs refs and 2020-12 keywords', async () => {
    const parameters: RemoteToolDefinition['parameters'] = {
      type: 'object',
      properties: {
        item: { $ref: '#/$defs/Item' },
        pair: { type: 'array', prefixItems: [{ type: 'string' }], items: false },
      },
      $defs: { Item: { type: 'number' } },
    };
    const tool: RemoteToolDefinition = {
      name: 'ns_refs',
      description: 'Refs',
      parameters,
      _remote: {
        provider: {} as RemoteToolDefinition['_remote']['provider'],
        originalName: 'refs',
        inputSchema: parameters,
        annotations: { destructiveHint: true },
      },
    };
    const valid = await run(tool, { item: 3, pair: ['a'] });
    expect(valid.calls).toEqual([{ item: 3, pair: ['a'] }]);

    const invalid = await run(tool, { item: 'x', pair: ['a', 'b'] });
    expect(invalid.calls).toEqual([]);
    expect(invalid.result.message).toContain('args/item must be number');
  });

  test('denies an MCP edit that breaks a top-level constraint of the complete input schema', async () => {
    const inputSchema = {
      type: 'object',
      properties: { title: { type: 'string' } },
      required: ['title'],
      additionalProperties: false,
    };
    const tool: RemoteToolDefinition = {
      name: 'ns_strict',
      description: 'Strict',
      parameters: { type: 'object', properties: inputSchema.properties, required: inputSchema.required },
      _remote: {
        provider: {} as RemoteToolDefinition['_remote']['provider'],
        originalName: 'strict',
        inputSchema,
        annotations: { destructiveHint: true },
      },
    };
    const { result, calls } = await run(tool, { title: 'Edited', admin: true });
    expect(calls).toEqual([]);
    expect(result.error).toBe(true);
    expect(result.message).toContain('args must NOT have additional properties');
  });

  test('denies a defineServerTool edit with a key its strict Zod schema forbids', async () => {
    const tool = serverToolFrom(z.object({ title: z.string() }).strict());
    const { result, calls } = await run(tool, { title: 'Edited', admin: true });
    expect(calls).toEqual([]);
    expect(result.error).toBe(true);
    expect(result.message).toContain('Edited arguments are invalid');
  });
});

describe('approval requests that accept edited arguments', () => {
  test('createApprovalWrapper marks its approval request as accepting modifiedArgs', async () => {
    const session = createTestSession({ abortController: new AbortController() });
    const emitted: Record<string, unknown>[] = [];
    const tool: ToolDefinition = {
      name: 'x', description: 'x', parameters: { type: 'object', properties: {} }, annotations: { destructiveHint: true },
    };
    const promise = createApprovalWrapper(tool, session, { emit: (e: unknown) => { emitted.push(e as Record<string, unknown>); } } as EventEmitter, async () => 'ok')({}, { toolCallId: 'tc-1' });
    session.pendingToolApprovals.get('tc-1')!({ approved: true });
    await promise;
    expect(emitted[0].acceptsModifiedArgs).toBe(true);
  });

  test('waitForApproval denies an approval carrying modifiedArgs unless the request accepts them', async () => {
    const session = createTestSession({ abortController: new AbortController() });
    const promise = waitForApproval(session, 'tc-1');
    session.pendingToolApprovals.get('tc-1')!({ approved: true, modifiedArgs: { title: 'Edited' } });
    const result = await promise;
    expect(result.approved).toBe(false);
    expect(result.reason).toContain('does not accept edited arguments');
  });

  test('waitForApproval passes modifiedArgs through when the request accepts them', async () => {
    const session = createTestSession({ abortController: new AbortController() });
    const promise = waitForApproval(session, 'tc-1', { acceptsModifiedArgs: true });
    session.pendingToolApprovals.get('tc-1')!({ approved: true, modifiedArgs: { title: 'Edited' } });
    expect(await promise).toEqual({ approved: true, modifiedArgs: { title: 'Edited' } });
  });
});
