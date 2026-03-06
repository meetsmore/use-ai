import { describe, expect, test } from 'bun:test';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { v4 as uuidv4 } from 'uuid';
import { AISDKAgent } from './AISDKAgent';
import type { AgentInput, EventEmitter, AGUIEventExtended } from './types';
import type { ServerToolDefinition } from '../tools/types';

function createToolLoopMockModel(toolName: string, calls: { count: number }) {
  return new MockLanguageModelV3({
    doStream: async () => {
      calls.count++;
      const toolCallId = `tool-call-${calls.count}`;

      return {
        stream: simulateReadableStream({
          chunks: [
            { type: 'tool-input-start', id: toolCallId, toolName },
            { type: 'tool-input-delta', id: toolCallId, delta: '{}' },
            { type: 'tool-input-end', id: toolCallId },
            { type: 'tool-call', toolCallId, toolName, input: '{}' },
            {
              type: 'finish',
              finishReason: 'tool-calls' as const,
              usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
            },
          ],
        }),
        response: {
          id: `response-${calls.count}`,
          timestamp: new Date(),
          modelId: 'mock-model',
          headers: {},
          messages: [
            {
              role: 'assistant' as const,
              content: [
                {
                  type: 'tool-call' as const,
                  toolCallId,
                  toolName,
                  input: {},
                },
              ],
            },
          ],
        },
      };
    },
  });
}

function createTestInput(tools: ServerToolDefinition[]): AgentInput {
  const threadId = uuidv4();
  const runId = uuidv4();

  return {
    session: {
      socket: {} as never,
      clientId: 'client-1',
      threadId: 'thread-1',
      tools: [],
      state: null,
      pendingToolCalls: new Map(),
      pendingToolApprovals: new Map(),
      ipAddress: '127.0.0.1',
    },
    runId,
    messages: [{ role: 'user', content: 'loop' }],
    tools,
    state: null,
    originalInput: {
      threadId,
      runId,
      messages: [{ id: uuidv4(), role: 'user', content: 'loop' }],
      tools,
      state: null,
      context: [],
      forwardedProps: {},
    },
  };
}

describe('AISDKAgent maxSteps', () => {
  const loopToolName = 'loop_tool';

  const loopTool: ServerToolDefinition = {
    name: loopToolName,
    description: 'Loop tool',
    parameters: { type: 'object', properties: {} },
    _server: {
      execute: () => ({ ok: true }),
    },
  };

  test('defaults to 10 step iterations', async () => {
    const calls = { count: 0 };
    const mockModel = createToolLoopMockModel(loopToolName, calls);
    const agent = new AISDKAgent({ model: mockModel });

    const emittedEvents: AGUIEventExtended[] = [];
    const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

    const result = await agent.run(createTestInput([loopTool]), eventEmitter);

    expect(result.success).toBe(true);
    expect(calls.count).toBe(10);
  });

  test('uses configured maxSteps from constructor', async () => {
    const calls = { count: 0 };
    const mockModel = createToolLoopMockModel(loopToolName, calls);
    const agent = new AISDKAgent({ model: mockModel, maxSteps: 2 });

    const emittedEvents: AGUIEventExtended[] = [];
    const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

    const result = await agent.run(createTestInput([loopTool]), eventEmitter);

    expect(result.success).toBe(true);
    expect(calls.count).toBe(2);
  });
});
