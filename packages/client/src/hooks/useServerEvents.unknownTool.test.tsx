import { describe, it, expect, mock, beforeEach, afterEach, spyOn } from 'bun:test';
import { renderHook, act } from '@testing-library/react';
import { useServerEvents } from './useServerEvents';
import { defaultStrings } from '../theme/strings';
import { EventType } from '../types';
import type { AGUIEvent, ToolDefinition } from '../types';
import type { UseToolSystemReturn } from './useToolSystem';
import type { UseAIClient } from '../client';

/**
 * A call reaches the client after TOOL_CALL_END. The client runs it only when
 * the tool is in its registry. These tests cover a call for a tool the
 * registry does not have.
 */
function setup(runTools: ToolDefinition[]) {
  const toolSystem = {
    aggregatedToolsRef: { current: {} },
    executeToolCall: mock(async () => undefined),
    storePendingToolCall: mock(),
    handleApprovalRequest: mock(),
    pendingApprovals: [],
    endRun: mock(),
  } as unknown as UseToolSystemReturn;
  const currentToolCalls = new Map<string, { name: string; args: string }>();
  const client = {
    runMessages: [],
    currentRunId: 'run-1',
    currentToolCalls,
    getRunTool: (name: string) => runTools.find(tool => tool.name === name),
  } as unknown as UseAIClient;
  const hook = renderHook(() =>
    useServerEvents({ toolSystem, saveAIResponse: mock(async () => {}), strings: defaultStrings }),
  );
  /** Delivers a whole tool call, as the client has assembled it by TOOL_CALL_END. */
  const call = async (toolCallId: string, name: string) => {
    currentToolCalls.set(toolCallId, { name, args: '{"a":1}' });
    await act(async () => {
      await hook.result.current.handleServerEvent(client, { type: EventType.TOOL_CALL_START, toolCallId, toolCallName: name, timestamp: 0 } as AGUIEvent);
      await hook.result.current.handleServerEvent(client, { type: EventType.TOOL_CALL_END, toolCallId, timestamp: 0 } as AGUIEvent);
    });
  };
  return { toolSystem, call };
}

const tool = (name: string, destructive = false): ToolDefinition => ({
  name,
  description: name,
  parameters: { type: 'object', properties: {} },
  ...(destructive ? { annotations: { destructiveHint: true } } : {}),
});

describe('useServerEvents — a call for a tool the client does not have', () => {
  let logSpy: ReturnType<typeof spyOn>;
  beforeEach(() => { logSpy = spyOn(console, 'log').mockImplementation(() => {}); });
  afterEach(() => { logSpy.mockRestore(); });

  // The server waits for a result of every tool the client sent. Without one,
  // the run never ends. executeToolCall sends an error result for a tool that
  // is not in the registry.
  it('answers a client tool that is gone from the registry, so the run continues', async () => {
    const { toolSystem, call } = setup([tool('addTodo')]);

    await call('tc1', 'addTodo');

    expect(toolSystem.executeToolCall).toHaveBeenCalledWith('tc1', 'addTodo', { a: 1 });
  });

  // The server asks for approval before it waits for the result, so the
  // error result goes after the user's answer, as for a tool that is there.
  it('waits for approval first when the tool the client sent needs approval', async () => {
    const { toolSystem, call } = setup([tool('deleteTodo', true)]);

    await call('tc1', 'deleteTodo');

    expect(toolSystem.storePendingToolCall).toHaveBeenCalledWith('tc1', 'deleteTodo', { a: 1 }, { name: 'deleteTodo', args: '{"a":1}' });
    expect(toolSystem.executeToolCall).not.toHaveBeenCalled();
  });

  // Server and MCP tools are never sent by the client. The server runs them
  // and sends their result as TOOL_CALL_RESULT. A result from the client would
  // replace that result in the history.
  it('leaves a server or MCP tool call to the server', async () => {
    const { toolSystem, call } = setup([tool('addTodo')]);

    await call('tc1', 'mcp_search');

    expect(toolSystem.executeToolCall).not.toHaveBeenCalled();
    expect(toolSystem.storePendingToolCall).not.toHaveBeenCalled();
  });
});
