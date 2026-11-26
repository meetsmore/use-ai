import { describe, it, expect, mock, beforeEach, afterEach, spyOn } from 'bun:test';
import { renderHook, act } from '@testing-library/react';
import { useServerEvents, type ChatStreamingPart } from './useServerEvents';
import { defaultStrings } from '../theme/strings';
import { EventType } from '../types';
import type { AGUIEvent, Message } from '../types';
import type { PendingToolApproval, UseToolSystemReturn } from './useToolSystem';
import { UseAIClient } from '../client';
import { extractTurnMessages } from '../utils/messageConversion';
import { getTurnParts } from '../utils/toolCalls';
import type { PersistedMessage } from '../providers/chatRepository/types';

function makeToolSystem(pendingApprovals: PendingToolApproval[] = []): UseToolSystemReturn {
  return {
    aggregatedToolsRef: { current: {} },
    executeToolCall: mock(async () => undefined),
    storePendingToolCall: mock(),
    handleApprovalRequest: mock(),
    pendingApprovals,
  } as unknown as UseToolSystemReturn;
}

/**
 * Wires a real client to the hook the way UseAIProvider does: the client
 * processes each event first, then the hook gets it, and the hook hears tool
 * results through `onToolResult`.
 */
function setup(pendingApprovals: PendingToolApproval[] = []) {
  const toolSystem = makeToolSystem(pendingApprovals);
  const hook = renderHook(
    ({ approvals }: { approvals: PendingToolApproval[] }) =>
      useServerEvents({ toolSystem: { ...toolSystem, pendingApprovals: approvals }, saveAIResponse: mock(async () => {}), strings: defaultStrings }),
    { initialProps: { approvals: pendingApprovals } },
  );
  const client = new UseAIClient('http://localhost:8081');
  client.onToolResult((toolCallId, content) => hook.result.current.handleToolResult(toolCallId, content));
  const handleEvent = (client as unknown as { handleEvent(e: AGUIEvent): void }).handleEvent.bind(client);

  const emit = async (...events: Array<Record<string, unknown>>) => {
    await act(async () => {
      for (const event of events) {
        const full = { timestamp: 0, ...event } as unknown as AGUIEvent;
        handleEvent(full);
        await hook.result.current.handleServerEvent(client, full);
      }
    });
  };
  return { hook, client, toolSystem, emit };
}

function toolPart(parts: ChatStreamingPart[], toolCallId: string) {
  return parts.find(part => part.kind === 'tool_call' && part.toolCallId === toolCallId);
}

/** The run's messages as the provider persists them, read back as parts. */
function persistedPart(client: UseAIClient, toolCallId: string) {
  const turn = extractTurnMessages(client.runMessages as Message[], 0) as unknown as PersistedMessage[];
  return toolPart(getTurnParts(turn), toolCallId);
}

const START_CALL = [
  { type: EventType.RUN_STARTED, threadId: 't', runId: 'run-1' },
  { type: EventType.TOOL_CALL_START, toolCallId: 'tc1', toolCallName: 'pick' },
  { type: EventType.TOOL_CALL_ARGS, toolCallId: 'tc1', delta: '{"a":1}' },
  { type: EventType.TOOL_CALL_END, toolCallId: 'tc1' },
];

describe('useServerEvents — tool call status and result', () => {
  let logSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  beforeEach(() => {
    logSpy = spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('is receiving-args until the call is fully received, then running', async () => {
    const { hook, emit } = setup();
    await emit(START_CALL[0], START_CALL[1], START_CALL[2]);
    expect(toolPart(hook.result.current.streamingParts, 'tc1')).toMatchObject({ status: 'receiving-args' });

    await emit(START_CALL[3]);
    expect(toolPart(hook.result.current.streamingParts, 'tc1')).toMatchObject({ status: 'running' });
  });

  // Each case ends with what the server sends next. The streamed part must
  // already equal the persisted one, so the call looks the same after the
  // chat is reloaded.
  const cases: Array<{
    name: string;
    act: (client: UseAIClient) => void;
    serverResult?: string;
    expected: { status: string; result: string };
  }> = [
    {
      name: 'a browser tool that returns a string',
      act: client => client.sendToolResponse('tc1', 'hi'),
      // The server parses and re-serializes the result, so a string loses its quotes.
      serverResult: 'hi',
      expected: { status: 'done', result: '"hi"' },
    },
    {
      name: 'a browser tool that returns { success: false }',
      act: client => client.sendToolResponse('tc1', { success: false }),
      serverResult: '{"success":false}',
      expected: { status: 'error', result: '{"success":false}' },
    },
    {
      name: 'a call the user rejected',
      act: client => client.sendToolApprovalResponse('tc1', false, 'No'),
      serverResult: '{"error":true,"message":"Tool execution denied by user: No"}',
      expected: { status: 'rejected', result: '{"rejected":true,"reason":"No"}' },
    },
    {
      name: 'a server tool',
      act: () => {},
      serverResult: '{"temp":15}',
      expected: { status: 'done', result: '{"temp":15}' },
    },
  ];

  for (const testCase of cases) {
    it(`streams the persisted status and result for ${testCase.name}`, async () => {
      const { hook, client, emit } = setup();
      await emit(...START_CALL);
      act(() => testCase.act(client));
      await emit(
        { type: EventType.TOOL_CALL_RESULT, messageId: 'r1', toolCallId: 'tc1', content: testCase.serverResult, role: 'tool' },
      );

      expect(toolPart(hook.result.current.streamingParts, 'tc1')).toMatchObject(testCase.expected);

      await emit({ type: EventType.STEP_FINISHED, stepName: 's' });
      expect(persistedPart(client, 'tc1')).toMatchObject(testCase.expected);
    });
  }

  it('marks a call the stopped run never answered as aborted, as the history does', async () => {
    const { hook, client, emit } = setup();
    await emit(...START_CALL);
    act(() => client.finalizeRun({ aborted: true }));

    const aborted = { status: 'aborted', result: '{"aborted":true,"reason":"Cancelled by user before tool finished"}' };
    expect(toolPart(hook.result.current.streamingParts, 'tc1')).toMatchObject(aborted);
    expect(persistedPart(client, 'tc1')).toMatchObject(aborted);
  });

  it('shows a running call as awaiting-approval while its approval is pending', async () => {
    const pending = (toolCallId: string) => [{ toolCallId, toolCallName: 'pick', toolCallArgs: {} }];
    const { hook, emit } = setup(pending('tc1'));
    await emit(...START_CALL);
    expect(toolPart(hook.result.current.streamingParts, 'tc1')).toMatchObject({ status: 'awaiting-approval' });

    // A runtime approval from ctx.requestApproval is pending under a suffixed id.
    hook.rerender({ approvals: pending('tc1-runtime-1700000000000') });
    expect(toolPart(hook.result.current.streamingParts, 'tc1')).toMatchObject({ status: 'awaiting-approval' });

    hook.rerender({ approvals: [] });
    expect(toolPart(hook.result.current.streamingParts, 'tc1')).toMatchObject({ status: 'running' });
  });
});
