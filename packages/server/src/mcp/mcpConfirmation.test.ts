import { describe, expect, test, mock } from 'bun:test';
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
      confirmation_required: true,
      message: 'Are you sure?',
      execute_on_approval: {
        tool: 'confirm_action',
        args: { id: 1 },
      },
    })).toBe(true);
  });

  test('returns true with optional metadata', () => {
    expect(isMcpConfirmationResponse({
      confirmation_required: true,
      message: 'Transfer $5000?',
      metadata: { amount: 5000, to: 'Bob' },
      execute_on_approval: {
        tool: 'confirm_transfer',
        args: { to: 'Bob', amount: 5000 },
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

  test('returns false when confirmation_required is not true', () => {
    expect(isMcpConfirmationResponse({
      confirmation_required: false,
      message: 'msg',
      execute_on_approval: { tool: 't', args: {} },
    })).toBe(false);
  });

  test('returns false when message is missing', () => {
    expect(isMcpConfirmationResponse({
      confirmation_required: true,
      execute_on_approval: { tool: 't', args: {} },
    })).toBe(false);
  });

  test('returns false when execute_on_approval is missing', () => {
    expect(isMcpConfirmationResponse({
      confirmation_required: true,
      message: 'msg',
    })).toBe(false);
  });

  test('returns false when execute_on_approval.tool is missing', () => {
    expect(isMcpConfirmationResponse({
      confirmation_required: true,
      message: 'msg',
      execute_on_approval: { args: {} },
    })).toBe(false);
  });

  test('returns false when execute_on_approval.args is missing', () => {
    expect(isMcpConfirmationResponse({
      confirmation_required: true,
      message: 'msg',
      execute_on_approval: { tool: 't' },
    })).toBe(false);
  });

  test('returns false for normal tool result', () => {
    expect(isMcpConfirmationResponse({ success: true, data: 'ok' })).toBe(false);
  });
});

describe('handleMcpConfirmation', () => {
  const confirmation: McpConfirmationResponse = {
    confirmation_required: true,
    message: 'Transfer $5000 to Bob. Are you sure?',
    metadata: { amount: 5000, to: 'Bob' },
    execute_on_approval: {
      tool: 'confirm_transfer',
      args: { to: 'Bob', amount: 5000, confirmed: true },
    },
  };

  test('emits TOOL_APPROVAL_REQUEST event', async () => {
    const session = createTestSession();
    const events = createMockEmitter();
    const provider = createMockProvider();

    // Start the handler (it will wait for approval)
    const promise = handleMcpConfirmation(
      confirmation,
      'tool-call-1',
      'ns_transfer',
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
    expect(emitted.toolCallArgs).toEqual({ to: 'Bob', amount: 5000, confirmed: true });

    // Resolve approval to complete the promise
    const resolver = session.pendingToolApprovals.get('tool-call-1');
    resolver!({ approved: true });
    await promise;
  });

  test('calls phase-2 tool when approved', async () => {
    const session = createTestSession();
    const events = createMockEmitter();
    const provider = createMockProvider({ success: true, message: 'Transferred' });

    const promise = handleMcpConfirmation(
      confirmation,
      'tool-call-1',
      'ns_transfer',
      provider,
      session,
      events
    );

    // Approve
    const resolver = session.pendingToolApprovals.get('tool-call-1');
    resolver!({ approved: true });

    const result = await promise;

    // Verify phase-2 was called with correct tool/args
    expect(provider.executedCalls).toHaveLength(1);
    expect(provider.executedCalls[0].toolName).toBe('confirm_transfer');
    expect(provider.executedCalls[0].args).toEqual({ to: 'Bob', amount: 5000, confirmed: true });
    expect(result).toEqual({ success: true, message: 'Transferred' });
  });

  test('returns error result when rejected', async () => {
    const session = createTestSession();
    const events = createMockEmitter();
    const provider = createMockProvider();

    const promise = handleMcpConfirmation(
      confirmation,
      'tool-call-1',
      'ns_transfer',
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
