import { describe, it, expect, mock } from 'bun:test';
import { renderHook, act } from '@testing-library/react';
import { useServerEvents } from './useServerEvents';
import { defaultStrings } from '../theme/strings';
import { EventType } from '../types';
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

function makeClient() {
  return {
    messages: [],
    currentMessageContent: '',
    currentReasoningBlocks: [],
    currentRunId: 'run-1',
    finalizeRun: mock(() => {}),
    currentToolCalls: new Map(),
  } as unknown as UseAIClient;
}

function setup() {
  const { result } = renderHook(() =>
    useServerEvents({ toolSystem: makeToolSystem(), saveAIResponse: mock(async () => {}), strings: defaultStrings }),
  );
  return { result, client: makeClient() };
}

/**
 * `streamingText` and `streamingReasoning` flatten a whole run into two
 * strings, so a multi-step run's thinking arrives as one block. `streamingParts`
 * keeps the step boundaries the run actually had.
 */
describe('useServerEvents — streaming parts', () => {
  it('keeps each step of reasoning separate instead of concatenating them', async () => {
    const { result, client } = setup();

    await act(async () => {
      await result.current.handleServerEvent(client, { type: EventType.RUN_STARTED, threadId: 't', runId: 'run-1' });
      await result.current.handleServerEvent(client, { type: EventType.REASONING_MESSAGE_START, messageId: 'r1' });
      await result.current.handleServerEvent(client, { type: EventType.REASONING_MESSAGE_CONTENT, messageId: 'r1', delta: 'First I check the time.' });
      await result.current.handleServerEvent(client, { type: EventType.REASONING_MESSAGE_END, messageId: 'r1' });
      await result.current.handleServerEvent(client, { type: EventType.REASONING_MESSAGE_START, messageId: 'r2' });
      await result.current.handleServerEvent(client, { type: EventType.REASONING_MESSAGE_CONTENT, messageId: 'r2', delta: 'Then I add the numbers.' });
    });

    expect(result.current.streamingParts).toEqual([
      { kind: 'reasoning', text: 'First I check the time.' },
      { kind: 'reasoning', text: 'Then I add the numbers.' },
    ]);
    // The flattened string keeps its existing shape for the built-in bubble.
    expect(result.current.streamingReasoning).toBe('First I check the time.\n\nThen I add the numbers.');
  });

  it('interleaves reasoning, tool calls and text in the order they arrived', async () => {
    const { result, client } = setup();

    await act(async () => {
      await result.current.handleServerEvent(client, { type: EventType.RUN_STARTED, threadId: 't', runId: 'run-1' });
      await result.current.handleServerEvent(client, { type: EventType.REASONING_MESSAGE_START, messageId: 'r1' });
      await result.current.handleServerEvent(client, { type: EventType.REASONING_MESSAGE_CONTENT, messageId: 'r1', delta: 'Need the time.' });
      await result.current.handleServerEvent(client, { type: EventType.TOOL_CALL_START, toolCallId: 'tc1', toolCallName: 'getServerTime' });
      await result.current.handleServerEvent(client, { type: EventType.TOOL_CALL_ARGS, toolCallId: 'tc1', delta: '{"tz":' });
      await result.current.handleServerEvent(client, { type: EventType.TOOL_CALL_ARGS, toolCallId: 'tc1', delta: '"UTC"}' });
      await result.current.handleServerEvent(client, { type: EventType.TEXT_MESSAGE_START, messageId: 'm1' });
      await result.current.handleServerEvent(client, { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm1', delta: 'It is noon.' });
    });

    expect(result.current.streamingParts).toEqual([
      { kind: 'reasoning', text: 'Need the time.' },
      { kind: 'tool_call', toolCallId: 'tc1', name: 'getServerTime', args: '{"tz":"UTC"}' },
      { kind: 'text', text: 'It is noon.' },
    ]);
  });

  it('clears the parts when the run finishes', async () => {
    const { result, client } = setup();

    await act(async () => {
      await result.current.handleServerEvent(client, { type: EventType.RUN_STARTED, threadId: 't', runId: 'run-1' });
      await result.current.handleServerEvent(client, { type: EventType.TEXT_MESSAGE_START, messageId: 'm1' });
      await result.current.handleServerEvent(client, { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm1', delta: 'Done.' });
    });
    expect(result.current.streamingParts).toHaveLength(1);

    await act(async () => {
      await result.current.handleServerEvent(client, { type: EventType.RUN_FINISHED, threadId: 't', runId: 'run-1' });
    });
    expect(result.current.streamingParts).toEqual([]);
  });
});
