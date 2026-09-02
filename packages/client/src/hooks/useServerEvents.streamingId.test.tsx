import { describe, it, expect, mock } from 'bun:test';
import { renderHook, act } from '@testing-library/react';
import { useServerEvents } from './useServerEvents';
import { defaultStrings } from '../theme/strings';
import { ErrorCode, EventType } from '../types';
import type { UseToolSystemReturn } from './useToolSystem';
import type { UseAIClient } from '../client';

function makeToolSystem(): UseToolSystemReturn {
  return {
    aggregatedToolsRef: { current: {} },
    executeToolCall: mock(async () => undefined),
    storePendingToolCall: mock(),
    handleApprovalRequest: mock(),
  } as unknown as UseToolSystemReturn;
}

function makeClient(currentMessageContent: string) {
  return {
    messages: [],
    currentMessageContent,
    currentReasoningBlocks: [],
    currentRunId: 'run-1',
    finalizeRun: mock(() => {}),
    currentToolCalls: new Map(),
  } as unknown as UseAIClient;
}

/**
 * The streaming answer and the persisted answer render under the same React
 * key, so the id the answer will be saved with must be known while it streams.
 */
describe('useServerEvents — streaming message id', () => {
  it('has no id before a run starts', () => {
    const { result } = renderHook(() =>
      useServerEvents({ toolSystem: makeToolSystem(), saveAIResponse: mock(async () => {}), strings: defaultStrings }),
    );
    expect(result.current.streamingMessageId).toBeNull();
  });

  it('assigns an id at RUN_STARTED and persists the answer under that id at RUN_FINISHED', async () => {
    const saveAIResponse = mock(async () => {});
    const { result } = renderHook(() =>
      useServerEvents({ toolSystem: makeToolSystem(), saveAIResponse, strings: defaultStrings }),
    );
    const client = makeClient('Hello');

    await act(async () => {
      await result.current.handleServerEvent(client, { type: EventType.RUN_STARTED, threadId: 't', runId: 'run-1' });
    });
    const id = result.current.streamingMessageId;
    expect(id).toEqual(expect.any(String));

    await act(async () => {
      await result.current.handleServerEvent(client, { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm', delta: 'Hello' });
      await result.current.handleServerEvent(client, { type: EventType.RUN_FINISHED, threadId: 't', runId: 'run-1' });
    });

    expect(saveAIResponse).toHaveBeenCalledTimes(1);
    const [content, displayMode, , , , messageId] = saveAIResponse.mock.calls[0];
    expect(content).toBe('Hello');
    expect(displayMode).toBeUndefined();
    expect(messageId).toBe(id);
    expect(result.current.streamingMessageId).toBeNull();
  });

  it('persists the partial answer under the streaming id when the user stops the run', async () => {
    const saveAIResponse = mock(async () => {});
    const { result } = renderHook(() =>
      useServerEvents({ toolSystem: makeToolSystem(), saveAIResponse, strings: defaultStrings }),
    );
    const client = makeClient('Partial');

    await act(async () => {
      await result.current.handleServerEvent(client, { type: EventType.RUN_STARTED, threadId: 't', runId: 'run-1' });
    });
    const id = result.current.streamingMessageId;

    await act(async () => {
      await result.current.handleServerEvent(client, { type: EventType.RUN_ERROR, message: ErrorCode.ABORTED });
    });

    expect(saveAIResponse).toHaveBeenCalledTimes(2);
    expect(saveAIResponse.mock.calls[0][5]).toBe(id);
    // The abort notice is a separate bubble and must not reuse the answer's id.
    expect(saveAIResponse.mock.calls[1][1]).toBe('info');
    expect(saveAIResponse.mock.calls[1][5]).toBeUndefined();
  });

  it('uses a fresh id for each run', async () => {
    const { result } = renderHook(() =>
      useServerEvents({ toolSystem: makeToolSystem(), saveAIResponse: mock(async () => {}), strings: defaultStrings }),
    );
    const client = makeClient('');
    await act(async () => {
      await result.current.handleServerEvent(client, { type: EventType.RUN_STARTED, threadId: 't', runId: 'run-1' });
    });
    const first = result.current.streamingMessageId;
    await act(async () => {
      await result.current.handleServerEvent(client, { type: EventType.RUN_FINISHED, threadId: 't', runId: 'run-1' });
      await result.current.handleServerEvent(client, { type: EventType.RUN_STARTED, threadId: 't', runId: 'run-2' });
    });
    expect(result.current.streamingMessageId).not.toBe(first);
  });
});
