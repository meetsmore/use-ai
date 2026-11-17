import { describe, it, expect, mock } from 'bun:test';
import { renderHook, act } from '@testing-library/react';
import { useServerEvents } from './useServerEvents';
import { defaultStrings } from '../theme/strings';
import { EventType } from '../types';
import type { AGUIEvent } from '../types';
import type { UseToolSystemReturn } from './useToolSystem';
import type { UseAIClient } from '../client';

function setup() {
  const order: string[] = [];
  const toolSystem = {
    aggregatedToolsRef: { current: {} },
    executeToolCall: mock(async () => undefined),
    storePendingToolCall: mock(),
    handleApprovalRequest: mock(),
    pendingApprovals: [],
    abortRunSignal: mock(() => { order.push('abort'); }),
  } as unknown as UseToolSystemReturn;
  const client = {
    runMessages: [],
    currentMessageContent: '',
    currentReasoningBlocks: [],
    currentRunId: 'run-1',
    finalizeRun: mock(() => { order.push('finalize'); }),
    currentToolCalls: new Map(),
  } as unknown as UseAIClient;
  const hook = renderHook(() =>
    useServerEvents({ toolSystem, saveAIResponse: mock(async () => {}), strings: defaultStrings }),
  );
  const emit = async (...events: Array<Record<string, unknown>>) => {
    await act(async () => {
      for (const event of events) {
        await hook.result.current.handleServerEvent(client, { timestamp: 0, ...event } as unknown as AGUIEvent);
      }
    });
  };
  return { hook, toolSystem, order, emit };
}

describe('useServerEvents — ctx.signal of the run', () => {
  it('aborts the tool signal whenever the run ends', async () => {
    const { hook, toolSystem, emit } = setup();
    await emit({ type: EventType.RUN_STARTED, threadId: 't', runId: 'run-1' }, { type: EventType.RUN_FINISHED, threadId: 't', runId: 'run-1' });
    await emit({ type: EventType.RUN_STARTED, threadId: 't', runId: 'run-2' }, { type: EventType.RUN_ERROR, message: 'API_OVERLOADED' });
    await emit({ type: EventType.RUN_STARTED, threadId: 't', runId: 'run-3' });
    // handleDisconnect only acts on a run in flight, which sending a message marks.
    act(() => hook.result.current.setLoading(true));
    act(() => hook.result.current.handleDisconnect());

    expect(toolSystem.abortRunSignal).toHaveBeenCalledTimes(3);
  });

  it('aborts the tool signal before a stopped run is recorded and saved', async () => {
    const { order, emit } = setup();
    await emit({ type: EventType.RUN_STARTED, threadId: 't', runId: 'run-1' });
    await emit({ type: EventType.RUN_ERROR, message: 'ABORTED' });

    expect(order[0]).toBe('abort');
    expect(order).toContain('finalize');
  });
});
