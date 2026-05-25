import { describe, it, expect, mock } from 'bun:test';
import { renderHook, act } from '@testing-library/react';
import { useServerEvents } from './useServerEvents';
import { defaultStrings } from '../theme/strings';
import { ErrorCode, EventType } from '../types';
import type { UseToolSystemReturn } from './useToolSystem';
import type { UseAIClient } from '../client';

function makeToolSystem(): UseToolSystemReturn {
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
  } as unknown as UseToolSystemReturn;
}

/**
 * Minimal stub of UseAIClient — only the surface `useServerEvents` touches
 * is implemented. `flushPartialStateForAbort` is exercised via a mock spy.
 */
function makeClient(overrides: Partial<{
  messages: unknown[];
  currentMessageContent: string;
  currentReasoningBlocks: unknown[];
  currentRunId: string | null;
}> = {}) {
  const flushPartialStateForAbort = mock(() => {});
  const client = {
    messages: overrides.messages ?? [],
    currentMessageContent: overrides.currentMessageContent ?? '',
    currentReasoningBlocks: overrides.currentReasoningBlocks ?? [],
    currentRunId: overrides.currentRunId ?? null,
    flushPartialStateForAbort,
    currentToolCalls: new Map(),
  } as unknown as UseAIClient;
  return { client, flushPartialStateForAbort };
}

describe('useServerEvents — abort handling', () => {
  it('on RUN_ERROR with ABORTED, flushes partial state and saves a non-error response with partial text', async () => {
    const saveAIResponse = mock(async () => {});
    const { result } = renderHook(() =>
      useServerEvents({
        toolSystem: makeToolSystem(),
        saveAIResponse,
        strings: defaultStrings,
      }),
    );

    const { client, flushPartialStateForAbort } = makeClient({
      currentMessageContent: 'Hello, this is a partial respo',
      currentRunId: 'run-abc',
    });

    await act(async () => {
      // RUN_STARTED snapshots the runId and turn-start index.
      await result.current.handleServerEvent(client, {
        type: EventType.RUN_STARTED,
        threadId: 't1',
        runId: 'run-abc',
        timestamp: Date.now(),
      } as never);

      await result.current.handleServerEvent(client, {
        type: EventType.RUN_ERROR,
        message: ErrorCode.ABORTED,
        timestamp: Date.now(),
      } as never);
    });

    expect(flushPartialStateForAbort).toHaveBeenCalledTimes(1);
    expect(saveAIResponse).toHaveBeenCalledTimes(1);

    const [content, displayMode, traceId, turnMessages] = saveAIResponse.mock.calls[0];
    expect(content).toBe('Hello, this is a partial respo');
    expect(displayMode).toBeUndefined(); // NOT 'error'
    expect(traceId).toBe('run-abc');
    expect(turnMessages).toEqual([]);

    expect(result.current.loading).toBe(false);
    expect(result.current.streamingText).toBe('');
  });

  it('on RUN_ERROR with ABORTED and no partial content, still saves so synthetic tool_results land in storage', async () => {
    const saveAIResponse = mock(async () => {});
    const { result } = renderHook(() =>
      useServerEvents({
        toolSystem: makeToolSystem(),
        saveAIResponse,
        strings: defaultStrings,
      }),
    );

    // Simulate one flushed assistant(toolCalls) + tool_result pair, then abort.
    const flushedMessages = [
      {
        id: 'a1',
        role: 'assistant' as const,
        content: '',
        toolCalls: [{ id: 'tc1', type: 'function' as const, function: { name: 'doThing', arguments: '{}' } }],
      },
      { id: 't1', role: 'tool' as const, content: '{"ok":true}', toolCallId: 'tc1' },
    ];
    const { client, flushPartialStateForAbort } = makeClient({
      messages: [],
      currentMessageContent: '',
      currentRunId: 'run-xyz',
    });

    await act(async () => {
      await result.current.handleServerEvent(client, {
        type: EventType.RUN_STARTED,
        threadId: 't1',
        runId: 'run-xyz',
        timestamp: Date.now(),
      } as never);

      // After RUN_STARTED, the turn-start index is messages.length (here: 0
      // because messages was empty). Simulate the flushed step messages
      // being added during the run.
      (client as unknown as { messages: unknown[] }).messages = flushedMessages;

      await result.current.handleServerEvent(client, {
        type: EventType.RUN_ERROR,
        message: ErrorCode.ABORTED,
        timestamp: Date.now(),
      } as never);
    });

    expect(flushPartialStateForAbort).toHaveBeenCalledTimes(1);
    expect(saveAIResponse).toHaveBeenCalledTimes(1);

    const [content, displayMode, , turnMessages] = saveAIResponse.mock.calls[0];
    expect(content).toBe('');
    expect(displayMode).toBeUndefined();
    // turnMessages should contain the flushed tool_use + tool_result pair so
    // the next sendPrompt still ships a valid Anthropic API payload.
    expect(Array.isArray(turnMessages)).toBe(true);
    expect((turnMessages as unknown[]).length).toBe(2);
  });

  it('on RUN_ERROR with a non-ABORTED code, falls back to the existing error message flow', async () => {
    const saveAIResponse = mock(async () => {});
    const { result } = renderHook(() =>
      useServerEvents({
        toolSystem: makeToolSystem(),
        saveAIResponse,
        strings: defaultStrings,
      }),
    );

    const { client, flushPartialStateForAbort } = makeClient();

    await act(async () => {
      await result.current.handleServerEvent(client, {
        type: EventType.RUN_ERROR,
        message: ErrorCode.API_OVERLOADED,
        timestamp: Date.now(),
      } as never);
    });

    expect(flushPartialStateForAbort).not.toHaveBeenCalled();
    expect(saveAIResponse).toHaveBeenCalledTimes(1);
    const [content, displayMode] = saveAIResponse.mock.calls[0];
    expect(content).toBe(defaultStrings.errors[ErrorCode.API_OVERLOADED]);
    expect(displayMode).toBe('error');
  });
});
