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

describe('useToolSystem approval matches what executes (security finding I6)', () => {
  function requestApprovalShowing(
    result: ReturnType<typeof setup>['result'],
    toolCallId: string,
    called: { name: string; args: Record<string, unknown> },
    shown: { name: string; args: Record<string, unknown> },
  ) {
    act(() => {
      result.current.storePendingToolCall(toolCallId, called.name, called.args, {
        name: called.name,
        args: JSON.stringify(called.args),
      });
      result.current.handleApprovalRequest({
        type: TOOL_APPROVAL_REQUEST,
        toolCallId,
        toolCallName: shown.name,
        toolCallArgs: shown.args,
        timestamp: 0,
        acceptsModifiedArgs: true,
      });
    });
  }

  it('refuses to run a tool whose call arguments differ from the approved arguments', async () => {
    const { result, client, executed } = setup();
    requestApprovalShowing(
      result,
      'tc-1',
      { name: 'createItem', args: { title: 'Hidden' } },
      { name: 'createItem', args: { title: 'Shown' } },
    );

    await act(async () => {
      await result.current.approveAll();
    });

    expect(executed).toEqual([]);
    const [toolCallId, response] = client.sendToolResponse.mock.calls[0] as [string, { error: string }];
    expect(toolCallId).toBe('tc-1');
    expect(response.error).toContain('differs from the tool call the user approved');
  });

  it('refuses to run a tool whose name differs from the approved tool, even with edited arguments', async () => {
    const { result, client, executed } = setup();
    requestApprovalShowing(
      result,
      'tc-1',
      { name: 'createItem', args: { title: 'Same' } },
      { name: 'renameItem', args: { title: 'Same' } },
    );

    await act(async () => {
      await result.current.approveWithArgs({ 'tc-1': { title: 'Edited' } });
    });

    expect(executed).toEqual([]);
    const [, response] = client.sendToolResponse.mock.calls[0] as [string, { error: string }];
    expect(response.error).toContain('differs from the tool call the user approved');
  });

  it('runs the tool with the edited arguments when the call arguments differ from the shown ones', async () => {
    const { result, executed } = setup();
    requestApprovalShowing(
      result,
      'tc-1',
      { name: 'createItem', args: { title: 'Hidden' } },
      { name: 'createItem', args: { title: 'Shown' } },
    );

    await act(async () => {
      await result.current.approveWithArgs({ 'tc-1': { title: 'Edited' } });
    });

    expect(executed).toEqual([{ title: 'Edited' }]);
  });

  it('runs the tool when the approved arguments equal the call arguments in a different key order', async () => {
    const { result, executed } = setup();
    requestApprovalShowing(
      result,
      'tc-1',
      { name: 'createItem', args: { title: 'Same', tags: { a: 1, b: [1, 2] } } },
      { name: 'createItem', args: { tags: { b: [1, 2], a: 1 }, title: 'Same' } },
    );

    await act(async () => {
      await result.current.approveAll();
    });

    // The tool schema strips the unknown `tags` key; the call ran.
    expect(executed).toEqual([{ title: 'Same' }]);
  });

  it('refuses when an array in the call arguments differs from the approved arguments', async () => {
    const { result, executed } = setup();
    requestApprovalShowing(
      result,
      'tc-1',
      { name: 'createItem', args: { title: 'Same', ids: [1, 2, 3] } },
      { name: 'createItem', args: { title: 'Same', ids: [1, 2] } },
    );

    await act(async () => {
      await result.current.approveAll();
    });

    expect(executed).toEqual([]);
  });
});
