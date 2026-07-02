import { describe, expect, test } from 'bun:test';
import { MockLanguageModelV3 } from 'ai/test';
import { simulateReadableStream } from 'ai';
import { v4 as uuidv4 } from 'uuid';
import { AISDKAgent } from './AISDKAgent';
import type { AgentInput, EventEmitter, AGUIEventExtended } from './types';
import type { ServerToolDefinition } from '../tools/types';
import { EventType } from '@meetsmore-oss/use-ai-core';

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

/**
 * A mock model that always returns tool calls for the first `toolCallSteps` invocations,
 * then returns a text response for the final (graceful summary) call.
 */
function createToolThenTextMockModel(
  toolName: string,
  toolCallSteps: number,
  calls: { count: number }
) {
  return new MockLanguageModelV3({
    doStream: async () => {
      calls.count++;
      const callIndex = calls.count;

      if (callIndex <= toolCallSteps) {
        const toolCallId = `tool-call-${callIndex}`;
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
            id: `response-${callIndex}`,
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
      } else {
        // Graceful summary call: return text
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'text-start', id: 'summary-text' },
              { type: 'text-delta', id: 'summary-text', delta: 'I have completed ' },
              { type: 'text-delta', id: 'summary-text', delta: 'the requested actions.' },
              { type: 'text-end', id: 'summary-text' },
              {
                type: 'finish',
                finishReason: 'stop' as const,
                usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
              },
            ],
          }),
          response: {
            id: `response-${callIndex}`,
            timestamp: new Date(),
            modelId: 'mock-model',
            headers: {},
            messages: [
              {
                role: 'assistant' as const,
                content: [{ type: 'text' as const, text: 'I have completed the requested actions.' }],
              },
            ],
          },
        };
      }
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
    // 10 main iterations + 1 graceful summary call = 11 total
    expect(calls.count).toBe(11);
  });

  test('uses configured maxSteps from constructor', async () => {
    const calls = { count: 0 };
    const mockModel = createToolLoopMockModel(loopToolName, calls);
    const agent = new AISDKAgent({ model: mockModel, maxSteps: 2 });

    const emittedEvents: AGUIEventExtended[] = [];
    const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

    const result = await agent.run(createTestInput([loopTool]), eventEmitter);

    expect(result.success).toBe(true);
    // 2 main iterations + 1 graceful summary call = 3 total
    expect(calls.count).toBe(3);
  });

  test('uses maxSteps from runtimeConfig override', async () => {
    const calls = { count: 0 };
    const mockModel = createToolLoopMockModel(loopToolName, calls);
    // Static default is 10; the resolved override must bound the loop instead
    const agent = new AISDKAgent({
      model: mockModel,
      runtimeConfig: () => ({ maxSteps: 2 }),
    });

    const emittedEvents: AGUIEventExtended[] = [];
    const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

    const result = await agent.run(createTestInput([loopTool]), eventEmitter);

    expect(result.success).toBe(true);
    // 2 main iterations + 1 graceful summary call = 3 total
    expect(calls.count).toBe(3);
  });

  test('emits text message after maxSteps when last step had tool calls', async () => {
    const calls = { count: 0 };
    const mockModel = createToolThenTextMockModel(loopToolName, 2, calls);
    const agent = new AISDKAgent({ model: mockModel, maxSteps: 2 });

    const emittedEvents: AGUIEventExtended[] = [];
    const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

    const result = await agent.run(createTestInput([loopTool]), eventEmitter);

    expect(result.success).toBe(true);
    // 2 main iterations + 1 graceful summary call = 3 total
    expect(calls.count).toBe(3);

    // A text message should have been emitted from the graceful summary
    const textStartEvents = emittedEvents.filter(e => e.type === EventType.TEXT_MESSAGE_START);
    const textContentEvents = emittedEvents.filter(e => e.type === EventType.TEXT_MESSAGE_CONTENT);
    const textEndEvents = emittedEvents.filter(e => e.type === EventType.TEXT_MESSAGE_END);

    expect(textStartEvents.length).toBe(1);
    expect(textContentEvents.length).toBeGreaterThan(0);
    expect(textEndEvents.length).toBe(1);

    // The final response text should contain the summary
    const allText = textContentEvents
      .map(e => ('delta' in e ? (e as { delta: string }).delta : ''))
      .join('');
    expect(allText).toBe('I have completed the requested actions.');
  });

  test('does not emit extra call when run completes normally (no tool calls)', async () => {
    const calls = { count: 0 };
    // Model that returns text immediately (no tool calls)
    const textModel = new MockLanguageModelV3({
      doStream: async () => {
        calls.count++;
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'text-start', id: 'text-1' },
              { type: 'text-delta', id: 'text-1', delta: 'Done.' },
              { type: 'text-end', id: 'text-1' },
              {
                type: 'finish',
                finishReason: 'stop' as const,
                usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
              },
            ],
          }),
          response: {
            id: 'response-1',
            timestamp: new Date(),
            modelId: 'mock-model',
            headers: {},
            messages: [{ role: 'assistant' as const, content: [{ type: 'text' as const, text: 'Done.' }] }],
          },
        };
      },
    });

    const agent = new AISDKAgent({ model: textModel, maxSteps: 5 });
    const emittedEvents: AGUIEventExtended[] = [];
    const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

    const result = await agent.run(createTestInput([loopTool]), eventEmitter);

    expect(result.success).toBe(true);
    // Only 1 call — no graceful summary needed when last step had no tool calls
    expect(calls.count).toBe(1);
  });
});
