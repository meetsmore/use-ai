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
 * is implemented. `finalizeRun` is exercised via a mock spy.
 */
function makeClient(overrides: Partial<{
  messages: unknown[];
  currentMessageContent: string;
  currentReasoningBlocks: unknown[];
  currentRunId: string | null;
}> = {}) {
  const finalizeRun = mock(() => {});
  const client = {
    messages: overrides.messages ?? [],
    currentMessageContent: overrides.currentMessageContent ?? '',
    currentReasoningBlocks: overrides.currentReasoningBlocks ?? [],
    currentRunId: overrides.currentRunId ?? null,
    finalizeRun,
    currentToolCalls: new Map(),
  } as unknown as UseAIClient;
  return { client, finalizeRun };
}

describe('useServerEvents — abort handling', () => {
  it('stopping mid text-stream saves the partial reply plus a separate info bubble', async () => {
    // Stateful mock mimicking saveAIResponse's real load-modify-save of the
    // whole chat. The async gap between read and write means that if the two
    // abort-path saves are fired concurrently (not awaited), the second clobbers
    // the first — dropping the partial reply and only persisting the notice.
    // Asserting `store` keeps both entries guards against that regression.
    let store: Array<{ content: string; displayMode?: string }> = [];
    const saveAIResponse = mock(async (content: string, displayMode?: string) => {
      const snapshot = store;
      await new Promise((r) => setTimeout(r, 0));
      store = [...snapshot, { content, displayMode }];
    });
    const { result } = renderHook(() =>
      useServerEvents({
        toolSystem: makeToolSystem(),
        saveAIResponse,
        strings: defaultStrings,
      }),
    );

    const { client, finalizeRun } = makeClient({
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

    expect(finalizeRun).toHaveBeenCalledTimes(1);
    expect(saveAIResponse).toHaveBeenCalledTimes(2);

    // First bubble: the partial reply (normal, non-error, carries context).
    const [content, displayMode, traceId, turnMessages] = saveAIResponse.mock.calls[0];
    expect(content).toBe('Hello, this is a partial respo');
    expect(displayMode).toBeUndefined(); // NOT 'error'
    expect(traceId).toBe('run-abc');
    expect(turnMessages).toEqual([]);

    // Second bubble: the display-only interruption notice.
    const [noticeContent, noticeMode] = saveAIResponse.mock.calls[1];
    expect(noticeContent).toBe(defaultStrings.notices.aborted);
    expect(noticeMode).toBe('info');

    // Both saves must land in storage. If they raced (un-awaited), the notice
    // save would clobber the partial-reply save and `store` would hold only one.
    expect(store).toEqual([
      { content: 'Hello, this is a partial respo', displayMode: undefined },
      { content: defaultStrings.notices.aborted, displayMode: 'info' },
    ]);

    expect(result.current.loading).toBe(false);
    expect(result.current.streamingParts).toEqual([]);
  });

  it('stopping mid tool-execution saves the tool_use/tool_result pair to history so the next turn stays valid', async () => {
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
    const { client, finalizeRun } = makeClient({
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

    expect(finalizeRun).toHaveBeenCalledTimes(1);
    expect(saveAIResponse).toHaveBeenCalledTimes(1);

    const [content, displayMode, traceId, turnMessages] = saveAIResponse.mock.calls[0];
    // No streamed text → no placeholder text bubble. The info notice carries
    // the turnMessages so the tool_use/tool_result pair still persists.
    expect(content).toBe(defaultStrings.notices.aborted);
    expect(displayMode).toBe('info');
    expect(traceId).toBe('run-xyz');
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

    const { client, finalizeRun } = makeClient();

    await act(async () => {
      await result.current.handleServerEvent(client, {
        type: EventType.RUN_ERROR,
        message: ErrorCode.API_OVERLOADED,
        timestamp: Date.now(),
      } as never);
    });

    expect(finalizeRun).not.toHaveBeenCalled();
    expect(saveAIResponse).toHaveBeenCalledTimes(1);
    const [content, displayMode] = saveAIResponse.mock.calls[0];
    expect(content).toBe(defaultStrings.errors[ErrorCode.API_OVERLOADED]);
    expect(displayMode).toBe('error');
  });
});
