import { describe, it, expect, mock, beforeEach, afterEach, spyOn } from 'bun:test';
import { renderHook, act } from '@testing-library/react';
import { useToolSystem } from './useToolSystem';
import { defineTool, type ToolExecutionContext } from '../defineTool';
import type { UseAIClient } from '../client';

function setup() {
  const client = { sendToolResponse: mock(), sendToolApprovalResponse: mock() } as unknown as UseAIClient;
  const hook = renderHook(() => useToolSystem({ clientRef: { current: client }, buildState: () => ({}) }));
  const contexts: ToolExecutionContext[] = [];
  let release: (value: unknown) => void = () => {};
  const tool = defineTool('Waits until released', (ctx) => {
    contexts.push(ctx);
    return new Promise(resolve => { release = resolve; });
  });
  act(() => {
    hook.result.current.registerTools('owner', { wait: tool }, { invisible: true });
    hook.result.current.signalReady('owner');
  });
  return { hook, client, contexts, release: (value: unknown) => release(value) };
}

describe('useToolSystem — ctx.toolCallId and ctx.signal', () => {
  let logSpy: ReturnType<typeof spyOn>;
  beforeEach(() => { logSpy = spyOn(console, 'log').mockImplementation(() => {}); });
  afterEach(() => { logSpy.mockRestore(); });

  it('hands the tool its call id and a signal that aborts when the run ends', async () => {
    const { hook, client, contexts, release } = setup();

    let execution: Promise<void> = Promise.resolve();
    act(() => { execution = hook.result.current.executeToolCall('tc1', 'wait', {}); });
    await act(async () => { await Promise.resolve(); });
    expect(contexts[0].toolCallId).toBe('tc1');
    expect(contexts[0].signal.aborted).toBe(false);

    act(() => hook.result.current.abortRunSignal());
    expect(contexts[0].signal.aborted).toBe(true);

    // The tool gives up after the run ended; its result has nowhere to go.
    release({ aborted: true });
    await act(async () => { await execution; });
    expect(client.sendToolResponse).not.toHaveBeenCalled();
  });

  it('keeps the signal of the run a call arrived in when it is approved later', async () => {
    const { hook, client, contexts } = setup();
    act(() => {
      hook.result.current.storePendingToolCall('tc1', 'wait', {}, { name: 'wait', args: '{}' });
      hook.result.current.handleApprovalRequest({ toolCallId: 'tc1', toolCallName: 'wait', toolCallArgs: {} } as never);
    });

    // The run ends before the user answers the approval card.
    act(() => hook.result.current.abortRunSignal());
    act(() => { void hook.result.current.approveAll(); });
    await act(async () => { await Promise.resolve(); });

    expect(client.sendToolApprovalResponse).toHaveBeenCalledWith('tc1', true);
    expect(contexts[0].signal.aborted).toBe(true);
  });

  it('gives the next run a fresh signal', async () => {
    const { hook, client, contexts, release } = setup();
    act(() => hook.result.current.abortRunSignal());

    let execution: Promise<void> = Promise.resolve();
    act(() => { execution = hook.result.current.executeToolCall('tc2', 'wait', {}); });
    await act(async () => { await Promise.resolve(); });
    expect(contexts[0].signal.aborted).toBe(false);

    release({ ok: true });
    await act(async () => { await execution; });
    expect(client.sendToolResponse).toHaveBeenCalledWith('tc2', { ok: true }, {});
  });
});
