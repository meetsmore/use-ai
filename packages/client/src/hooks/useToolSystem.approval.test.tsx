import { describe, it, expect, mock } from 'bun:test';
import { renderHook, act } from '@testing-library/react';
import { z } from 'zod';
import { useToolSystem } from './useToolSystem';
import { defineTool } from '../defineTool';
import { TOOL_APPROVAL_REQUEST } from '../types';
import type { UseAIClient } from '../client';

function setup() {
  const executed: unknown[] = [];
  const createItem = defineTool(
    'Create an item',
    z.object({ title: z.string() }),
    (input) => {
      executed.push(input);
      return { success: true };
    },
    { annotations: { destructiveHint: true } }
  );

  const client = {
    sendToolApprovalResponse: mock((..._args: unknown[]) => {}),
    sendToolResponse: mock((..._args: unknown[]) => {}),
  };
  const clientRef = { current: client as unknown as UseAIClient };

  const { result } = renderHook(() => useToolSystem({ clientRef, buildState: () => ({}) }));

  act(() => {
    result.current.registerTools('component', { createItem }, { invisible: true });
  });

  const requestApproval = (toolCallId: string, title: string, server: 'accepts-edits' | 'no-edits' = 'accepts-edits') => {
    act(() => {
      result.current.storePendingToolCall(toolCallId, 'createItem', { title }, {
        name: 'createItem',
        args: JSON.stringify({ title }),
      });
      result.current.handleApprovalRequest({
        type: TOOL_APPROVAL_REQUEST,
        toolCallId,
        toolCallName: 'createItem',
        toolCallArgs: { title },
        timestamp: 0,
        metadata: { preview: true },
        ...(server === 'accepts-edits' && { acceptsModifiedArgs: true }),
      });
    });
  };

  return { result, client, executed, requestApproval };
}

describe('useToolSystem approval with edited arguments', () => {
  it('approveAll runs the tool with the AI arguments and sends no modifiedArgs', async () => {
    const { result, client, executed, requestApproval } = setup();
    requestApproval('tc-1', 'Original');

    await act(async () => {
      await result.current.approveAll();
    });

    const [toolCallId, approved, , modifiedArgs] = client.sendToolApprovalResponse.mock.calls[0];
    expect([toolCallId, approved, modifiedArgs]).toEqual(['tc-1', true, undefined]);
    expect(executed).toEqual([{ title: 'Original' }]);
  });

  it('approveWithArgs runs the client tool with the edited arguments and sends them to the server', async () => {
    const { result, client, executed, requestApproval } = setup();
    requestApproval('tc-1', 'Original');

    await act(async () => {
      await result.current.approveWithArgs({ 'tc-1': { title: 'Edited' } });
    });

    expect(client.sendToolApprovalResponse).toHaveBeenCalledWith('tc-1', true, undefined, { title: 'Edited' });
    expect(executed).toEqual([{ title: 'Edited' }]);
  });

  it('approveWithArgs leaves calls without an entry on their AI arguments', async () => {
    const { result, client, executed, requestApproval } = setup();
    requestApproval('tc-1', 'First');
    requestApproval('tc-2', 'Second');

    await act(async () => {
      await result.current.approveWithArgs({ 'tc-2': { title: 'Second edited' } });
    });

    const [firstId, , , firstArgs] = client.sendToolApprovalResponse.mock.calls[0];
    expect([firstId, firstArgs]).toEqual(['tc-1', undefined]);
    expect(client.sendToolApprovalResponse).toHaveBeenCalledWith('tc-2', true, undefined, { title: 'Second edited' });
    expect(executed).toEqual([{ title: 'First' }, { title: 'Second edited' }]);
  });

  it('reports invalid edited arguments of a client tool as a tool error without running it', async () => {
    const { result, client, executed, requestApproval } = setup();
    requestApproval('tc-1', 'Original');

    await act(async () => {
      await result.current.approveWithArgs({ 'tc-1': { title: 42 } });
    });

    expect(executed).toEqual([]);
    const [toolCallId, response] = client.sendToolResponse.mock.calls[0] as [string, { error: string }];
    expect(toolCallId).toBe('tc-1');
    expect(response.error).toContain('expected string, received number');
  });

  it('keeps the approval metadata and whether it accepts edits on the pending approval', () => {
    const { result, requestApproval } = setup();
    requestApproval('tc-1', 'Original');
    requestApproval('tc-2', 'Other', 'no-edits');

    expect(result.current.pendingApprovals[0].metadata).toEqual({ preview: true });
    expect(result.current.pendingApprovals[0].acceptsModifiedArgs).toBe(true);
    expect(result.current.pendingApprovals[1].acceptsModifiedArgs).toBeUndefined();
  });

  it('approveWithArgs refuses edits for an approval that does not accept them and approves nothing', async () => {
    const { result, client, executed, requestApproval } = setup();
    requestApproval('tc-1', 'Original', 'no-edits');

    let error: unknown;
    await act(async () => {
      await result.current.approveWithArgs({ 'tc-1': { title: 'Edited' } }).catch((e: unknown) => { error = e; });
    });

    expect((error as Error).message).toContain('tc-1 does not accept edited arguments');
    expect(client.sendToolApprovalResponse).not.toHaveBeenCalled();
    expect(executed).toEqual([]);
    expect(result.current.pendingApprovals).toHaveLength(1);
  });
});
