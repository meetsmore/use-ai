import { describe, expect, test } from 'bun:test';
import {
  isMcpConfirmationResponse,
  handleMcpConfirmation,
  type McpConfirmationResponse,
} from './mcpConfirmation';
import type { ClientSession, EventEmitter } from '../agents/types';
import type { RemoteMcpToolsProvider } from './RemoteMcpToolsProvider';
import { TOOL_APPROVAL_REQUEST } from '../types';

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
    abortController: new AbortController(),
    ...overrides,
  };
}

/**
 * Helper to create a mock EventEmitter
 */
function createMockEmitter(): EventEmitter & { emittedEvents: unknown[] } {
  const emittedEvents: unknown[] = [];
  return {
    emit: (event: unknown) => { emittedEvents.push(event); },
    emittedEvents,
  } as EventEmitter & { emittedEvents: unknown[] };
}

/**
 * Helper to create a mock MCP provider
 */
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

describe('isMcpConfirmationResponse', () => {
  test('returns true for valid confirmation response', () => {
    expect(isMcpConfirmationResponse({
      _use_ai_internal: true,
      _use_ai_type: 'confirmation_required',
      _use_ai_metadata: {
        message: 'Are you sure?',
      },
    })).toBe(true);
  });

  test('returns true with optional metadata and additional_columns', () => {
    expect(isMcpConfirmationResponse({
      _use_ai_internal: true,
      _use_ai_type: 'confirmation_required',
      _use_ai_metadata: {
        message: 'Transfer $5000?',
        metadata: { amount: 5000, to: 'Bob' },
        additional_columns: { token: 'abc123' },
      },
    })).toBe(true);
  });

  test('returns false for null', () => {
    expect(isMcpConfirmationResponse(null)).toBe(false);
  });

  test('returns false for undefined', () => {
    expect(isMcpConfirmationResponse(undefined)).toBe(false);
  });

  test('returns false for non-object', () => {
    expect(isMcpConfirmationResponse('string')).toBe(false);
    expect(isMcpConfirmationResponse(42)).toBe(false);
  });

  test('returns false when _use_ai_internal is not true', () => {
    expect(isMcpConfirmationResponse({
      _use_ai_internal: false,
      _use_ai_type: 'confirmation_required',
      _use_ai_metadata: { message: 'msg' },
    })).toBe(false);
  });

  test('returns false when _use_ai_type is wrong', () => {
    expect(isMcpConfirmationResponse({
      _use_ai_internal: true,
      _use_ai_type: 'something_else',
      _use_ai_metadata: { message: 'msg' },
    })).toBe(false);
  });

  test('returns false when _use_ai_metadata is missing', () => {
    expect(isMcpConfirmationResponse({
      _use_ai_internal: true,
      _use_ai_type: 'confirmation_required',
    })).toBe(false);
  });

  test('returns false when _use_ai_metadata.message is missing', () => {
    expect(isMcpConfirmationResponse({
      _use_ai_internal: true,
      _use_ai_type: 'confirmation_required',
      _use_ai_metadata: {},
    })).toBe(false);
  });

  test('returns false when _use_ai_metadata.message is not a string', () => {
    expect(isMcpConfirmationResponse({
      _use_ai_internal: true,
      _use_ai_type: 'confirmation_required',
      _use_ai_metadata: { message: 123 },
    })).toBe(false);
  });

  test('returns false for normal tool result', () => {
    expect(isMcpConfirmationResponse({ success: true, data: 'ok' })).toBe(false);
  });

  test('rejects old schema (confirmation_required + execute_on_approval)', () => {
    expect(isMcpConfirmationResponse({
      confirmation_required: true,
      message: 'Are you sure?',
      execute_on_approval: {
        tool: 'confirm_action',
        args: { id: 1 },
      },
    })).toBe(false);
  });
});

describe('handleMcpConfirmation', () => {
  const originalArgs = { to: 'Bob', amount: 5000 };
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
      confirmation,
      'tool-call-1',
      'ns_transfer',
      'transfer',
      originalArgs,
      provider,
      session,
      events
    );

    // Verify event was emitted
    expect(events.emittedEvents).toHaveLength(1);
    const emitted = events.emittedEvents[0] as Record<string, unknown>;
    expect(emitted.type).toBe(TOOL_APPROVAL_REQUEST);
    expect(emitted.toolCallId).toBe('tool-call-1');
    expect(emitted.toolCallName).toBe('ns_transfer');
    expect(emitted.message).toBe('Transfer $5000 to Bob. Are you sure?');
    expect(emitted.metadata).toEqual({ amount: 5000, to: 'Bob' });
    // toolCallArgs should be originalArgs, NOT merged with additional_columns
    expect(emitted.toolCallArgs).toEqual({ to: 'Bob', amount: 5000 });

    // Resolve approval to complete the promise
    const resolver = session.pendingToolApprovals.get('tool-call-1');
    resolver!({ approved: true });
    await promise;
  });

  test('calls phase-2 with originalToolName and merged args when approved', async () => {
    const session = createTestSession();
    const events = createMockEmitter();
    const provider = createMockProvider({ success: true, message: 'Transferred' });

    const promise = handleMcpConfirmation(
      confirmation,
      'tool-call-1',
      'ns_transfer',
      'transfer',
      originalArgs,
      provider,
      session,
      events
    );

    // Approve
    const resolver = session.pendingToolApprovals.get('tool-call-1');
    resolver!({ approved: true });

    const result = await promise;

    // Verify phase-2 was called with originalToolName and merged args
    expect(provider.executedCalls).toHaveLength(1);
    expect(provider.executedCalls[0].toolName).toBe('transfer');
    expect(provider.executedCalls[0].args).toEqual({
      to: 'Bob',
      amount: 5000,
      token: 'random_fixed_token',
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
      _use_ai_metadata: {
        message: 'Are you sure?',
      },
    };

    const promise = handleMcpConfirmation(
      noColumnsConfirmation,
      'tool-call-1',
      'ns_transfer',
      'transfer',
      originalArgs,
      provider,
      session,
      events
    );

    const resolver = session.pendingToolApprovals.get('tool-call-1');
    resolver!({ approved: true });
    await promise;

    // Without additional_columns, phase-2 should use originalArgs as-is
    expect(provider.executedCalls[0].args).toEqual({ to: 'Bob', amount: 5000 });
  });

  test('returns error result when rejected', async () => {
    const session = createTestSession();
    const events = createMockEmitter();
    const provider = createMockProvider();

    const promise = handleMcpConfirmation(
      confirmation,
      'tool-call-1',
      'ns_transfer',
      'transfer',
      originalArgs,
      provider,
      session,
      events
    );

    // Reject
    const resolver = session.pendingToolApprovals.get('tool-call-1');
    resolver!({ approved: false, reason: 'Too expensive' });

    const result = await promise;

    // Verify no phase-2 call was made
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
      confirmation,
      'tool-call-1',
      'ns_transfer',
      'transfer',
      originalArgs,
      provider,
      session,
      events
    );

    const resolver = session.pendingToolApprovals.get('tool-call-1');
    resolver!({ approved: false });

    const result = await promise;
    expect(result).toEqual({
      error: true,
      message: 'Tool execution denied by user: Action was rejected',
    });
  });

  test('catches phase-2 execution error gracefully', async () => {
    const session = createTestSession();
    const events = createMockEmitter();

    // Provider that throws on executeTool
    const provider = {
      executeTool: async () => { throw new Error('MCP endpoint down'); },
    } as unknown as RemoteMcpToolsProvider;

    const promise = handleMcpConfirmation(
      confirmation,
      'tool-call-1',
      'ns_transfer',
      'transfer',
      originalArgs,
      provider,
      session,
      events
    );

    // Approve
    const resolver = session.pendingToolApprovals.get('tool-call-1');
    resolver!({ approved: true });

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
      confirmation,
      'tool-call-1',
      'ns_transfer',
      'transfer',
      originalArgs,
      provider,
      session,
      events,
      mcpHeaders
    );

    const resolver = session.pendingToolApprovals.get('tool-call-1');
    resolver!({ approved: true });
    await promise;

    expect(capturedHeaders).toBe(mcpHeaders);
  });
});
