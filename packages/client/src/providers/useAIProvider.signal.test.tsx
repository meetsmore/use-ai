import React from 'react';
import { describe, test, expect, spyOn } from 'bun:test';
import { render, act } from '@testing-library/react';
import { installSocketIOMock } from '../../test/socketIOMock';
import type { ToolExecutionContext } from '../defineTool';

// The test plays the server through the handlers the transport registers on the socket.
const socketIO = installSocketIOMock();

const { UseAIProvider } = await import('./useAIProvider');
const { useAI } = await import('../useAI');
const { defineTool } = await import('../defineTool');

const contexts: ToolExecutionContext[] = [];
const ask = defineTool('Waits for the user forever', (ctx) => {
  contexts.push(ctx);
  return new Promise(() => {});
});

function WaitingTool() {
  useAI({ tools: { ask }, invisible: true });
  return null;
}

describe('UseAIProvider — ctx.signal', () => {
  test('aborts the signal of a tool still waiting when the provider unmounts', async () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {});
    const { unmount } = render(
      <UseAIProvider serverUrl="http://localhost:8081" renderChat={false}>
        <WaitingTool />
      </UseAIProvider>
    );

    const emit = (event: Record<string, unknown>) => socketIO.fire('event', { timestamp: 0, ...event });
    await act(async () => {
      emit({ type: 'RUN_STARTED', threadId: 't', runId: 'run-1' });
      emit({ type: 'TOOL_CALL_START', toolCallId: 'tc1', toolCallName: 'ask' });
      emit({ type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '{}' });
      emit({ type: 'TOOL_CALL_END', toolCallId: 'tc1' });
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(contexts[0]?.toolCallId).toBe('tc1');
    expect(contexts[0].signal.aborted).toBe(false);

    unmount();

    expect(contexts[0].signal.aborted).toBe(true);
    logSpy.mockRestore();
  });
});
