import { describe, expect, test } from 'bun:test';
import {
  isMcpConfirmationResponse,
  handleMcpConfirmation,
  type McpConfirmationResponse,
} from './mcpConfirmation';
import type { UseAIInternalResponse } from './useAIInternalResponse';
import type { ClientSession, EventEmitter } from '../agents/types';
import type { RemoteMcpToolsProvider, RemoteToolDefinition } from './RemoteMcpToolsProvider';
import { TOOL_APPROVAL_REQUEST } from '../types';
import type { ToolDefinition } from '../types';

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
    abortController: new AbortController(),
    ...overrides,
  };
}

function createMockEmitter(): EventEmitter & { emittedEvents: unknown[] } {
  const emittedEvents: unknown[] = [];
  return {
    emit: (event: unknown) => { emittedEvents.push(event); },
    emittedEvents,
  } as EventEmitter & { emittedEvents: unknown[] };
}

function createMockProvider(
  executeResult: unknown = { success: true }
): RemoteMcpToolsProvider & { executedCalls: { toolName: string; args: unknown }[] } {
  const executedCalls: { toolName: string; args: unknown }[] = [];
  return {
    executeTool: async (toolName: string, args: unknown) => {
      executedCalls.push({ toolName, args });
      return executeResult;
    },
    executedCalls,
  } as RemoteMcpToolsProvider & { executedCalls: { toolName: string; args: unknown }[] };
}

// ── isMcpConfirmationResponse (narrows from UseAIInternalResponse) ──────────

describe('isMcpConfirmationResponse', () => {
  test('returns true for valid confirmation_required', () => {
    const value: UseAIInternalResponse = {
      _use_ai_internal: true,
      _use_ai_type: 'confirmation_required',
      _use_ai_metadata: { message: 'Are you sure?' },
    };
    expect(isMcpConfirmationResponse(value)).toBe(true);
  });

  test('returns true with optional metadata and additional_columns', () => {
    const value: UseAIInternalResponse = {
      _use_ai_internal: true,
      _use_ai_type: 'confirmation_required',
      _use_ai_metadata: {
        message: 'Transfer $5000?',
        metadata: { amount: 5000 },
        additional_columns: { token: 'abc' },
      },
    };
    expect(isMcpConfirmationResponse(value)).toBe(true);
  });

  test('returns false for different _use_ai_type', () => {
    const value = {
      _use_ai_internal: true,
      _use_ai_type: 'future_feature',
      _use_ai_metadata: { message: 'hello' },
    };
    expect(isMcpConfirmationResponse(value)).toBe(false);
  });

  test('returns false when message is missing', () => {
    const value = {
      _use_ai_internal: true,
      _use_ai_type: 'confirmation_required',
      _use_ai_metadata: {},
    };
    expect(isMcpConfirmationResponse(value)).toBe(false);
  });

  test('returns false when message is not a string', () => {
    const value = {
      _use_ai_internal: true,
      _use_ai_type: 'confirmation_required',
      _use_ai_metadata: { message: 123 },
    };
    expect(isMcpConfirmationResponse(value)).toBe(false);
  });
});

// ── handleMcpConfirmation ───────────────────────────────────────────────────

describe('handleMcpConfirmation', () => {
  const originalArgs = { to: 'Bob', amount: 5000 };
  const inputSchema: ToolDefinition['parameters'] = {
    type: 'object',
    properties: { to: { type: 'string' }, amount: { type: 'number' } },
    required: ['to', 'amount'],
  };
  const remoteTool = (provider: RemoteMcpToolsProvider): RemoteToolDefinition => ({
    name: 'ns_transfer',
    description: 'Transfer money',
    parameters: inputSchema,
    _remote: { provider, originalName: 'transfer', inputSchema },
  });
  const confirmation: McpConfirmationResponse = {
    _use_ai_internal: true,
    _use_ai_type: 'confirmation_required',
    _use_ai_metadata: {
      message: 'Transfer $5000 to Bob. Are you sure?',
      metadata: { amount: 5000, to: 'Bob' },
      additional_columns: { token: 'random_fixed_token' },
    },
  };

  test('emits TOOL_APPROVAL_REQUEST with originalArgs (not merged args)', async () => {
    const session = createTestSession();
    const events = createMockEmitter();
    const provider = createMockProvider();

    const promise = handleMcpConfirmation(
      confirmation, 'tool-call-1', remoteTool(provider),
      originalArgs, session, events
    );

    expect(events.emittedEvents).toHaveLength(1);
    const emitted = events.emittedEvents[0] as Record<string, unknown>;
    expect(emitted.type).toBe(TOOL_APPROVAL_REQUEST);
    expect(emitted.toolCallId).toBe('tool-call-1');
    expect(emitted.toolCallName).toBe('ns_transfer');
    expect(emitted.message).toBe('Transfer $5000 to Bob. Are you sure?');
    expect(emitted.metadata).toEqual({ amount: 5000, to: 'Bob' });
    expect(emitted.toolCallArgs).toEqual({ to: 'Bob', amount: 5000 });
    expect(emitted.acceptsModifiedArgs).toBe(true);

    session.pendingToolApprovals.get('tool-call-1')!({ approved: true });
    await promise;
  });

  test('calls phase-2 with originalToolName and merged args when approved', async () => {
    const session = createTestSession();
    const events = createMockEmitter();
    const provider = createMockProvider({ success: true, message: 'Transferred' });

    const promise = handleMcpConfirmation(
      confirmation, 'tool-call-1', remoteTool(provider),
      originalArgs, session, events
    );

    session.pendingToolApprovals.get('tool-call-1')!({ approved: true });
    const result = await promise;

    expect(provider.executedCalls).toHaveLength(1);
    expect(provider.executedCalls[0].toolName).toBe('transfer');
    expect(provider.executedCalls[0].args).toEqual({
      to: 'Bob', amount: 5000, token: 'random_fixed_token',
    });
    expect(result).toEqual({ success: true, message: 'Transferred' });
  });

  test('calls phase-2 with originalArgs only when no additional_columns', async () => {
    const session = createTestSession();
    const events = createMockEmitter();
    const provider = createMockProvider({ success: true });

    const noColumnsConfirmation: McpConfirmationResponse = {
      _use_ai_internal: true,
      _use_ai_type: 'confirmation_required',
      _use_ai_metadata: { message: 'Are you sure?' },
    };

    const promise = handleMcpConfirmation(
      noColumnsConfirmation, 'tool-call-1', remoteTool(provider),
      originalArgs, session, events
    );

    session.pendingToolApprovals.get('tool-call-1')!({ approved: true });
    await promise;

    expect(provider.executedCalls[0].args).toEqual({ to: 'Bob', amount: 5000 });
  });

  test('returns error result when rejected', async () => {
    const session = createTestSession();
    const events = createMockEmitter();
    const provider = createMockProvider();

    const promise = handleMcpConfirmation(
      confirmation, 'tool-call-1', remoteTool(provider),
      originalArgs, session, events
    );

    session.pendingToolApprovals.get('tool-call-1')!({ approved: false, reason: 'Too expensive' });
    const result = await promise;

    expect(provider.executedCalls).toHaveLength(0);
    expect(result).toEqual({
      error: true,
      message: 'Tool execution denied by user: Too expensive',
    });
  });

  test('returns error result when rejection has no reason', async () => {
    const session = createTestSession();
    const events = createMockEmitter();
    const provider = createMockProvider();

    const promise = handleMcpConfirmation(
      confirmation, 'tool-call-1', remoteTool(provider),
      originalArgs, session, events
    );

    session.pendingToolApprovals.get('tool-call-1')!({ approved: false });
    const result = await promise;

    expect(result).toEqual({
      error: true,
      message: 'Tool execution denied by user: Action was rejected',
    });
  });

  test('catches phase-2 execution error gracefully', async () => {
    const session = createTestSession();
    const events = createMockEmitter();
    const provider = {
      executeTool: async () => { throw new Error('MCP endpoint down'); },
    } as unknown as RemoteMcpToolsProvider;

    const promise = handleMcpConfirmation(
      confirmation, 'tool-call-1', remoteTool(provider),
      originalArgs, session, events
    );

    session.pendingToolApprovals.get('tool-call-1')!({ approved: true });
    const result = await promise;

    expect(result).toEqual({
      error: true,
      message: 'MCP confirmation execution failed: MCP endpoint down',
    });
  });

  test('passes MCP headers to phase-2 call', async () => {
    const session = createTestSession();
    const events = createMockEmitter();
    const mcpHeaders = { 'https://example.com/*': { headers: { Authorization: 'Bearer tok' } } };
    let capturedHeaders: unknown;
    const provider = {
      executeTool: async (_name: string, _args: unknown, headers: unknown) => {
        capturedHeaders = headers;
        return { success: true };
      },
    } as unknown as RemoteMcpToolsProvider;

    const promise = handleMcpConfirmation(
      confirmation, 'tool-call-1', remoteTool(provider),
      originalArgs, session, events, mcpHeaders
    );

    session.pendingToolApprovals.get('tool-call-1')!({ approved: true });
    await promise;

    expect(capturedHeaders).toBe(mcpHeaders);
  });
  function createSequencedProvider(results: unknown[]) {
    const executedCalls: { toolName: string; args: unknown }[] = [];
    const provider = {
      executeTool: async (toolName: string, args: unknown) => {
        executedCalls.push({ toolName, args });
        return results[executedCalls.length - 1];
      },
    } as unknown as RemoteMcpToolsProvider;
    return { provider, executedCalls };
  }

  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  test('re-runs phase 1 with edited args and asks again before phase 2 runs them', async () => {
    const session = createTestSession();
    const events = createMockEmitter();
    const reconfirmation: McpConfirmationResponse = {
      _use_ai_internal: true,
      _use_ai_type: 'confirmation_required',
      _use_ai_metadata: {
        message: 'Transfer $300 to Carol. Are you sure?',
        metadata: { amount: 300, to: 'Carol' },
        additional_columns: { token: 'token_for_carol' },
      },
    };
    const { provider, executedCalls } = createSequencedProvider([reconfirmation, { success: true }]);

    const promise = handleMcpConfirmation(
      confirmation, 'tool-call-1', remoteTool(provider),
      originalArgs, session, events
    );

    session.pendingToolApprovals.get('tool-call-1')!({
      approved: true,
      modifiedArgs: { to: 'Carol', amount: 300 },
    });
    await tick();

    expect(executedCalls).toEqual([{ toolName: 'transfer', args: { to: 'Carol', amount: 300 } }]);
    expect(events.emittedEvents).toHaveLength(2);
    const second = events.emittedEvents[1] as Record<string, unknown>;
    expect(second.message).toBe('Transfer $300 to Carol. Are you sure?');
    expect(second.toolCallArgs).toEqual({ to: 'Carol', amount: 300 });

    session.pendingToolApprovals.get('tool-call-1')!({ approved: true });
    const result = await promise;

    expect(executedCalls[1]).toEqual({
      toolName: 'transfer',
      args: { to: 'Carol', amount: 300, token: 'token_for_carol' },
    });
    expect(result).toEqual({ success: true });
  });

  test('returns the re-run phase-1 result when the edited args need no confirmation', async () => {
    const session = createTestSession();
    const events = createMockEmitter();
    const { provider, executedCalls } = createSequencedProvider([{ success: true, message: 'Done' }]);

    const promise = handleMcpConfirmation(
      confirmation, 'tool-call-1', remoteTool(provider),
      originalArgs, session, events
    );

    session.pendingToolApprovals.get('tool-call-1')!({
      approved: true,
      modifiedArgs: { to: 'Carol', amount: 1 },
    });

    expect(await promise).toEqual({ success: true, message: 'Done' });
    expect(executedCalls).toEqual([{ toolName: 'transfer', args: { to: 'Carol', amount: 1 } }]);
  });

  test('a re-confirmation that is rejected runs nothing further', async () => {
    const session = createTestSession();
    const events = createMockEmitter();
    const { provider, executedCalls } = createSequencedProvider([confirmation]);

    const promise = handleMcpConfirmation(
      confirmation, 'tool-call-1', remoteTool(provider),
      originalArgs, session, events
    );

    session.pendingToolApprovals.get('tool-call-1')!({ approved: true, modifiedArgs: { to: 'Carol', amount: 2 } });
    await tick();
    session.pendingToolApprovals.get('tool-call-1')!({ approved: false, reason: 'Changed my mind' });

    expect(await promise).toEqual({ error: true, message: 'Tool execution denied by user: Changed my mind' });
    expect(executedCalls).toHaveLength(1);
  });

  test('does not call phase-2 when modifiedArgs fail the input schema', async () => {
    const session = createTestSession();
    const events = createMockEmitter();
    const provider = createMockProvider({ success: true });

    const promise = handleMcpConfirmation(
      confirmation, 'tool-call-1', remoteTool(provider),
      originalArgs, session, events
    );

    session.pendingToolApprovals.get('tool-call-1')!({
      approved: true,
      modifiedArgs: { to: 'Carol', amount: 'a lot' },
    });
    const result = await promise as { error: boolean; message: string };

    expect(provider.executedCalls).toHaveLength(0);
    expect(result.error).toBe(true);
    expect(result.message).toContain('Edited arguments are invalid');
    expect(result.message).toContain('args/amount must be number');
  });
});
