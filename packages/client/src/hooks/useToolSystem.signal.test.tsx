import { describe, it, expect, mock, beforeEach, afterEach, spyOn } from 'bun:test';
import { renderHook, act } from '@testing-library/react';
import { useToolSystem } from './useToolSystem';
import { defineTool, type ToolExecutionContext } from '../defineTool';
import type { UseAIClient } from '../client';

function setup({ invisible = true }: { invisible?: boolean } = {}) {
  const client = { sendToolResponse: mock(), sendToolApprovalResponse: mock() } as unknown as UseAIClient;
  const hook = renderHook(() => useToolSystem({ clientRef: { current: client }, buildState: () => ({}) }));
  const contexts: ToolExecutionContext[] = [];
  let release: (value: unknown) => void = () => {};
  const tool = defineTool('Waits until released', (ctx) => {
    contexts.push(ctx);
    return new Promise(resolve => { release = resolve; });
  });
  act(() => {
    hook.result.current.registerTools('owner', { wait: tool }, { invisible });
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

    act(() => hook.result.current.endRun());
    expect(contexts[0].signal.aborted).toBe(true);

    // The tool gives up after the run ended; its result has nowhere to go.
    release({ aborted: true });
    await act(async () => { await execution; });
    expect(client.sendToolResponse).not.toHaveBeenCalled();
  });

  it('drops a call still waiting for approval when the run ends, so approving later runs nothing', async () => {
    const { hook, client, contexts } = setup();
    act(() => {
      hook.result.current.storePendingToolCall('tc1', 'wait', {}, { name: 'wait', args: '{}' });
      hook.result.current.handleApprovalRequest({ toolCallId: 'tc1', toolCallName: 'wait', toolCallArgs: {} } as never);
    });
    expect(hook.result.current.pendingApprovals).toHaveLength(1);

    // The run ends (stopped, failed or disconnected) before the user answers.
    act(() => hook.result.current.endRun());
    expect(hook.result.current.pendingApprovals).toHaveLength(0);

    await act(async () => { await hook.result.current.approveAll(); });
    expect(client.sendToolApprovalResponse).not.toHaveBeenCalled();
    expect(contexts).toHaveLength(0);
  });

  it('stops approving the rest when the run ends while an approved tool runs', async () => {
    const { hook, client, release } = setup();
    act(() => {
      hook.result.current.storePendingToolCall('tc1', 'wait', {}, { name: 'wait', args: '{}' });
      hook.result.current.storePendingToolCall('tc2', 'wait', {}, { name: 'wait', args: '{}' });
      hook.result.current.handleApprovalRequest({ toolCallId: 'tc1', toolCallName: 'wait', toolCallArgs: {} } as never);
      hook.result.current.handleApprovalRequest({ toolCallId: 'tc2', toolCallName: 'wait', toolCallArgs: {} } as never);
    });

    let approving: Promise<void> = Promise.resolve();
    act(() => { approving = hook.result.current.approveAll(); });
    await act(async () => { await Promise.resolve(); });
    act(() => hook.result.current.endRun());
    release({ ok: true });
    await act(async () => { await approving; });

    expect(client.sendToolApprovalResponse).toHaveBeenCalledTimes(1);
    expect(client.sendToolApprovalResponse).toHaveBeenCalledWith('tc1', true);
  });

  it('answers a tool waiting in ctx.requestApproval with not approved when the run ends', async () => {
    const client = { sendToolResponse: mock(), sendToolApprovalResponse: mock() } as unknown as UseAIClient;
    const hook = renderHook(() => useToolSystem({ clientRef: { current: client }, buildState: () => ({}) }));
    let answer: { approved: boolean; reason?: string } | undefined;
    const tool = defineTool('Asks for approval at runtime', async (ctx) => {
      answer = await ctx.requestApproval({ message: 'Go?' });
      return { done: true };
    });
    act(() => {
      hook.result.current.registerTools('owner', { ask: tool }, { invisible: true });
      hook.result.current.signalReady('owner');
    });

    let execution: Promise<void> = Promise.resolve();
    act(() => { execution = hook.result.current.executeToolCall('tc1', 'ask', {}); });
    await act(async () => { await Promise.resolve(); });
    expect(hook.result.current.pendingApprovals).toHaveLength(1);

    act(() => hook.result.current.endRun());
    await act(async () => { await execution; });

    expect(answer).toEqual({ approved: false, reason: 'The run ended before the user answered' });
    expect(hook.result.current.pendingApprovals).toHaveLength(0);
    expect(client.sendToolResponse).not.toHaveBeenCalled();
  });

  it('skips waiting for the prompt to update when the run ended while the tool worked', async () => {
    const { hook, client, release } = setup({ invisible: false });
    const waiter = mock(async () => {});
    act(() => hook.result.current.registerWaiter('owner', waiter));

    let execution: Promise<void> = Promise.resolve();
    act(() => { execution = hook.result.current.executeToolCall('tc1', 'wait', {}); });
    await act(async () => { await Promise.resolve(); });
    act(() => hook.result.current.endRun());
    release({ ok: true });
    await act(async () => { await execution; });

    expect(waiter).not.toHaveBeenCalled();
    expect(client.sendToolResponse).not.toHaveBeenCalled();
  });

  it('sends an error result when sending the tool result throws', async () => {
    const { hook, client, release } = setup();
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    (client.sendToolResponse as ReturnType<typeof mock>).mockImplementationOnce(() => {
      throw new TypeError('Do not know how to serialize a BigInt');
    });

    let execution: Promise<void> = Promise.resolve();
    act(() => { execution = hook.result.current.executeToolCall('tc1', 'wait', {}); });
    await act(async () => { await Promise.resolve(); });
    release({ id: 1n });
    await act(async () => { await execution; });

    expect(client.sendToolResponse).toHaveBeenLastCalledWith('tc1', { error: 'Do not know how to serialize a BigInt' });
    errorSpy.mockRestore();
  });

  it('gives the next run a fresh signal', async () => {
    const { hook, client, contexts, release } = setup();
    act(() => hook.result.current.endRun());

    let execution: Promise<void> = Promise.resolve();
    act(() => { execution = hook.result.current.executeToolCall('tc2', 'wait', {}); });
    await act(async () => { await Promise.resolve(); });
    expect(contexts[0].signal.aborted).toBe(false);

    release({ ok: true });
    await act(async () => { await execution; });
    expect(client.sendToolResponse).toHaveBeenCalledWith('tc2', { ok: true }, {});
  });
});
