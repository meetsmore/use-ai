import React, { useContext } from 'react';
import { describe, test, expect, mock, spyOn, beforeEach, afterEach } from 'bun:test';
import { render, act, cleanup } from '@testing-library/react';
import type { Socket } from 'socket.io-client';
import type { ChatUIContextValue } from '../components/UseAIChat';

// Handlers the transport registers on the socket, so the test can play the server.
const socketHandlers = new Map<string, (payload?: unknown) => void>();
const sent: Array<{ type: string; data: Record<string, unknown> }> = [];
let socket: Socket & { connected: boolean };

function createMockSocket() {
  const mockSocket: Partial<Socket> & { connected: boolean } = {
    on: mock((name: string, handler: (payload?: unknown) => void) => {
      socketHandlers.set(name, handler);
      return mockSocket as Socket;
    }) as unknown as Socket['on'],
    emit: mock((_name: string, message: { type: string; data: Record<string, unknown> }) => {
      sent.push(message);
      return mockSocket as Socket;
    }) as unknown as Socket['emit'],
    connected: false,
    disconnect: mock(() => mockSocket as Socket),
    io: { engine: { transport: { name: 'websocket' }, on: mock() } } as unknown as Socket['io'],
  };
  socket = mockSocket as Socket & { connected: boolean };
  return mockSocket as Socket;
}

mock.module('socket.io-client', () => ({
  io: () => createMockSocket(),
}));

const { UseAIProvider } = await import('./useAIProvider');
const { useAI } = await import('../useAI');
const { defineTool } = await import('../defineTool');
const { __UseAIChatContext } = await import('../components/UseAIChat');

let deleteRuns = 0;
const deleteItem = defineTool(
  'Delete the item',
  () => {
    deleteRuns++;
    return { ok: true };
  },
  { annotations: { destructiveHint: true } },
);

const runtimeAnswers: Array<{ approved: boolean; reason?: string }> = [];
const askFirst = defineTool('Asks the user before acting', async (ctx) => {
  runtimeAnswers.push(await ctx.requestApproval({ message: 'Go ahead?' }));
  return { ok: true };
});

function Tools() {
  useAI({ tools: { deleteItem, askFirst }, invisible: true });
  return null;
}

let chat: ChatUIContextValue;
function ChatProbe() {
  chat = useContext(__UseAIChatContext)!;
  return null;
}

const tick = (ms = 10) => new Promise(resolve => setTimeout(resolve, ms));
const emit = (event: Record<string, unknown>) => socketHandlers.get('event')!({ timestamp: 0, ...event });
const approvalResponses = () => sent.filter(message => message.type === 'tool_approval_response').map(message => message.data);

/** Renders the provider, connects, and sends a message. Returns the run's ids. */
async function startRun() {
  render(
    <UseAIProvider serverUrl="http://localhost:8081" renderChat={false}>
      <Tools />
      <ChatProbe />
    </UseAIProvider>
  );
  await act(async () => {
    socket.connected = true;
    socketHandlers.get('connect')!();
    await tick(0);
  });
  await act(async () => {
    await chat.sendMessage('hi');
    await tick();
  });
  const runAgent = sent.find(message => message.type === 'run_agent')!;
  const run = { threadId: runAgent.data.threadId as string, runId: runAgent.data.runId as string };
  await act(async () => {
    emit({ type: 'RUN_STARTED', ...run });
    await tick();
  });
  return run;
}

/** Plays the server asking for approval of a destructiveHint tool call. */
async function requestDeleteApproval() {
  await act(async () => {
    emit({ type: 'TOOL_CALL_START', toolCallId: 'tc1', toolCallName: 'deleteItem' });
    emit({ type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '{}' });
    emit({ type: 'TOOL_CALL_END', toolCallId: 'tc1' });
    emit({ type: 'TOOL_APPROVAL_REQUEST', toolCallId: 'tc1', toolCallName: 'deleteItem', toolCallArgs: {} });
    await tick();
  });
}

describe('UseAIProvider — approvals outside the run\'s chat', () => {
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    logSpy = spyOn(console, 'log').mockImplementation(() => {});
    socketHandlers.clear();
    sent.length = 0;
    deleteRuns = 0;
    runtimeAnswers.length = 0;
  });

  afterEach(() => {
    cleanup();
    logSpy.mockRestore();
  });

  test('rejects a pending approval when the user switches to a new chat, and the run can finish', async () => {
    const run = await startRun();
    await requestDeleteApproval();
    expect(chat.tools.pending.tools).toHaveLength(1);

    await act(async () => {
      await chat.history.create();
      await tick();
    });

    expect(chat.tools.pending.tools).toHaveLength(0);
    expect(approvalResponses()).toEqual([
      { toolCallId: 'tc1', approved: false, reason: 'The user switched to another chat' },
    ]);
    expect(deleteRuns).toBe(0);

    // The server takes the rejection and finishes the run, which frees the composer.
    await act(async () => {
      emit({ type: 'RUN_FINISHED', ...run });
      await tick();
    });
    expect(chat.loading).toBe(false);
  });

  test('rejects an approval that arrives after the user switched away', async () => {
    await startRun();

    await act(async () => {
      await chat.history.create();
      await tick();
    });
    expect(approvalResponses()).toEqual([]);

    await requestDeleteApproval();

    expect(chat.tools.pending.tools).toHaveLength(0);
    expect(approvalResponses()).toEqual([
      { toolCallId: 'tc1', approved: false, reason: 'The user switched to another chat' },
    ]);
    expect(deleteRuns).toBe(0);
  });

  test('rejects the approval of a run sent with no chat open once a chat is opened', async () => {
    render(
      <UseAIProvider serverUrl="http://localhost:8081" renderChat={false}>
        <Tools />
        <ChatProbe />
      </UseAIProvider>
    );
    await act(async () => {
      socket.connected = true;
      socketHandlers.get('connect')!();
      await tick(0);
    });
    // Deleting the displayed chat leaves no chat open.
    await act(async () => {
      await chat.history.delete(chat.history.currentId!);
      await tick();
    });
    expect(chat.history.currentId).toBeNull();
    await act(async () => {
      await chat.sendMessage('hi');
      await tick();
    });
    const runAgent = sent.find(message => message.type === 'run_agent')!;
    await act(async () => {
      emit({ type: 'RUN_STARTED', threadId: runAgent.data.threadId, runId: runAgent.data.runId });
      await tick();
    });
    await requestDeleteApproval();
    expect(chat.tools.pending.tools).toHaveLength(1);

    await act(async () => {
      await chat.history.create();
      await tick();
    });

    expect(chat.tools.pending.tools).toHaveLength(0);
    expect(approvalResponses()).toEqual([
      { toolCallId: 'tc1', approved: false, reason: 'The user switched to another chat' },
    ]);
  });

  test('keeps the approval when the user reopens the run\'s own chat', async () => {
    const run = await startRun();
    await requestDeleteApproval();

    await act(async () => {
      await chat.history.load(run.threadId);
      await tick();
    });

    expect(chat.tools.pending.tools).toHaveLength(1);
    expect(approvalResponses()).toEqual([]);

    await act(async () => {
      await chat.tools.pending.approveAll();
      await tick();
    });
    expect(deleteRuns).toBe(1);
  });

  test('answers a tool waiting in ctx.requestApproval with not approved', async () => {
    await startRun();
    await act(async () => {
      emit({ type: 'TOOL_CALL_START', toolCallId: 'tc2', toolCallName: 'askFirst' });
      emit({ type: 'TOOL_CALL_ARGS', toolCallId: 'tc2', delta: '{}' });
      emit({ type: 'TOOL_CALL_END', toolCallId: 'tc2' });
      await tick();
    });
    expect(chat.tools.pending.tools).toHaveLength(1);

    await act(async () => {
      await chat.history.create();
      await tick();
    });

    expect(chat.tools.pending.tools).toHaveLength(0);
    expect(runtimeAnswers).toEqual([{ approved: false, reason: 'The user switched to another chat' }]);
  });

  test('drops a pending approval on disconnect, so approving later runs nothing', async () => {
    await startRun();
    await requestDeleteApproval();

    await act(async () => {
      socket.connected = false;
      socketHandlers.get('disconnect')!('transport close');
      await tick();
    });

    expect(chat.tools.pending.tools).toHaveLength(0);
    expect(chat.loading).toBe(false);

    await act(async () => {
      await chat.tools.pending.approveAll();
      await tick();
    });
    expect(deleteRuns).toBe(0);
    expect(approvalResponses()).toEqual([]);
  });
});
