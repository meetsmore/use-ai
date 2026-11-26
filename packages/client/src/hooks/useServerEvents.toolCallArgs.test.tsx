import { describe, it, expect, mock, beforeEach, afterEach, spyOn } from 'bun:test';
import { renderHook, act } from '@testing-library/react';
import { useServerEvents } from './useServerEvents';
import { defaultStrings } from '../theme/strings';
import { EventType } from '../types';
import type { AGUIEvent, ToolDefinition } from '../types';
import type { UseToolSystemReturn } from './useToolSystem';
import type { UseAIClient } from '../client';

/**
 * The client reads a call's name and args at TOOL_CALL_END through the public
 * `getToolCallData`. The args are a JSON string. These tests cover how the
 * client reads them.
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
  const toolCalls = new Map<string, { name: string; args: string }>();
  const sendToolResponse = mock((_toolCallId: string, _result: unknown) => {});
  // Only public members: the hook must not read the client's private fields.
  const client = {
    runMessages: [],
    currentRunId: 'run-1',
    getToolCallData: (toolCallId: string) => toolCalls.get(toolCallId),
    getRunTool: (name: string) => runTools.find(tool => tool.name === name),
    sendToolResponse,
  } as unknown as UseAIClient;
  const hook = renderHook(() =>
    useServerEvents({ toolSystem, saveAIResponse: mock(async () => {}), strings: defaultStrings }),
  );
  const call = async (toolCallId: string, name: string, args: string) => {
    toolCalls.set(toolCallId, { name, args });
    await act(async () => {
      await hook.result.current.handleServerEvent(client, { type: EventType.TOOL_CALL_START, toolCallId, toolCallName: name, timestamp: 0 } as AGUIEvent);
      await hook.result.current.handleServerEvent(client, { type: EventType.TOOL_CALL_END, toolCallId, timestamp: 0 } as AGUIEvent);
    });
  };
  return { toolSystem, sendToolResponse, call };
}

const tool = (name: string): ToolDefinition => ({
  name,
  description: name,
  parameters: { type: 'object', properties: {} },
});

describe('useServerEvents — tool call args', () => {
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

  it('reads the call through getToolCallData and runs the tool', async () => {
    const { toolSystem, call } = setup([tool('addTodo')]);

    await call('tc1', 'addTodo', '{"text":"milk"}');

    expect(toolSystem.executeToolCall).toHaveBeenCalledWith('tc1', 'addTodo', { text: 'milk' });
  });

  // Without a result, the server waits for the tool forever and the run hangs.
  it('sends an error result when the args are not valid JSON', async () => {
    const { toolSystem, sendToolResponse, call } = setup([tool('addTodo')]);

    await call('tc1', 'addTodo', '{"text":');

    expect(toolSystem.executeToolCall).not.toHaveBeenCalled();
    expect(sendToolResponse).toHaveBeenCalledTimes(1);
    const [toolCallId, result] = sendToolResponse.mock.calls[0];
    expect(toolCallId).toBe('tc1');
    expect(result).toEqual({ error: expect.stringContaining('Invalid tool arguments') });
  });

  // The server runs its own tools and sends their results.
  it('leaves a server tool call with args that are not valid JSON to the server', async () => {
    const { toolSystem, sendToolResponse, call } = setup([tool('addTodo')]);

    await call('tc1', 'mcp_search', '{"query":');

    expect(toolSystem.executeToolCall).not.toHaveBeenCalled();
    expect(sendToolResponse).not.toHaveBeenCalled();
  });
});
