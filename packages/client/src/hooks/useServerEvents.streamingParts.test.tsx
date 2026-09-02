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
 * The parts are the only form the in-flight answer is kept in, so they must
 * carry the step boundaries the run actually had. Flattening them into what one
 * bubble shows happens in the UI; see utils/streamingParts.test.ts.
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
  });

  // A provider that streams reasoning deltas without a start chunk gets one
  // REASONING_MESSAGE_START for the whole step, so the block boundary the
  // persisted turn keeps (one block per REASONING_MESSAGE_END) has to come off
  // END here too. Otherwise the second block's text joins the first one and the
  // thinking text changes the moment the run finishes.
  it('starts a new reasoning part after a block ended, without a second start', async () => {
    const { result, client } = setup();

    await act(async () => {
      await result.current.handleServerEvent(client, { type: EventType.RUN_STARTED, threadId: 't', runId: 'run-1' });
      await result.current.handleServerEvent(client, { type: EventType.REASONING_MESSAGE_START, messageId: 'r1' });
      await result.current.handleServerEvent(client, { type: EventType.REASONING_MESSAGE_CONTENT, messageId: 'r1', delta: 'First I check the time.' });
      await result.current.handleServerEvent(client, { type: EventType.REASONING_MESSAGE_END, messageId: 'r1' });
      await result.current.handleServerEvent(client, { type: EventType.REASONING_MESSAGE_CONTENT, messageId: 'r1', delta: 'Then I add the numbers.' });
    });

    expect(result.current.streamingParts).toEqual([
      { kind: 'reasoning', text: 'First I check the time.' },
      { kind: 'reasoning', text: 'Then I add the numbers.' },
    ]);
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
      { kind: 'text', text: 'It is noon.', messageId: 'm1' },
    ]);
  });

  // The persisted turn keeps one assistant message per step, so a step's text
  // is one string there. Reasoning that arrives between two text deltas of the
  // same step must therefore not cut the text in two: the flattened parts would
  // gain a blank line the persisted message does not have, and the bubble would
  // change the moment the run finishes.
  it('keeps a step\'s text in one part when reasoning arrives between its deltas', async () => {
    const { result, client } = setup();

    await act(async () => {
      await result.current.handleServerEvent(client, { type: EventType.RUN_STARTED, threadId: 't', runId: 'run-1' });
      await result.current.handleServerEvent(client, { type: EventType.TEXT_MESSAGE_START, messageId: 'm1' });
      await result.current.handleServerEvent(client, { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm1', delta: 'It is ' });
      await result.current.handleServerEvent(client, { type: EventType.REASONING_MESSAGE_START, messageId: 'r1' });
      await result.current.handleServerEvent(client, { type: EventType.REASONING_MESSAGE_CONTENT, messageId: 'r1', delta: 'Check the clock.' });
      await result.current.handleServerEvent(client, { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm1', delta: 'noon.' });
    });

    expect(result.current.streamingParts).toEqual([
      { kind: 'text', text: 'It is noon.', messageId: 'm1' },
      { kind: 'reasoning', text: 'Check the clock.' },
    ]);
  });

  it('starts a new text part for the next step', async () => {
    const { result, client } = setup();

    await act(async () => {
      await result.current.handleServerEvent(client, { type: EventType.RUN_STARTED, threadId: 't', runId: 'run-1' });
      await result.current.handleServerEvent(client, { type: EventType.TEXT_MESSAGE_START, messageId: 'm1' });
      await result.current.handleServerEvent(client, { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm1', delta: 'Checking.' });
      await result.current.handleServerEvent(client, { type: EventType.TEXT_MESSAGE_END, messageId: 'm1' });
      await result.current.handleServerEvent(client, { type: EventType.TEXT_MESSAGE_START, messageId: 'm2' });
      await result.current.handleServerEvent(client, { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm2', delta: 'It is noon.' });
    });

    expect(result.current.streamingParts).toEqual([
      { kind: 'text', text: 'Checking.', messageId: 'm1' },
      { kind: 'text', text: 'It is noon.', messageId: 'm2' },
    ]);
  });

  // Every argument token of every tool call arrives as its own event, and the
  // whole panel re-renders on each new array. A run that is not building the
  // named call has nothing to change.
  it('keeps the same parts array when no tool call matches the args event', async () => {
    const { result, client } = setup();

    await act(async () => {
      await result.current.handleServerEvent(client, { type: EventType.RUN_STARTED, threadId: 't', runId: 'run-1' });
      await result.current.handleServerEvent(client, { type: EventType.TEXT_MESSAGE_START, messageId: 'm1' });
      await result.current.handleServerEvent(client, { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm1', delta: 'Working.' });
    });

    const before = result.current.streamingParts;

    await act(async () => {
      await result.current.handleServerEvent(client, { type: EventType.TOOL_CALL_ARGS, toolCallId: 'unknown', delta: '{}' });
    });

    expect(result.current.streamingParts).toBe(before);
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
