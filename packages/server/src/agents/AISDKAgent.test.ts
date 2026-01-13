import { describe, expect, test, mock } from 'bun:test';
import { AISDKAgent } from './AISDKAgent';
import type { AgentInput, EventEmitter } from './types';
import { EventType, ErrorCode } from '../types';
import type { AGUIEvent, ToolDefinition } from '../types';
import type { RemoteToolDefinition } from '../mcp';
import { v4 as uuidv4 } from 'uuid';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import {
  isRemoteTool,
  createGlobFilter,
  and,
  or,
  not,
} from '../utils/toolFilters';

/**
 * Helper to create a streaming mock model that emits text
 * Note: Model-level chunks use 'delta' for text-delta, not 'text'
 * The streamText function transforms these to 'text' in the public API
 */
function createStreamingTextMockModel(text: string) {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'text-start', id: 'text-1' },
          { type: 'text-delta', id: 'text-1', delta: text },
          { type: 'text-end', id: 'text-1' },
          {
            type: 'finish',
            finishReason: 'stop' as const,
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          },
        ],
      }),
      response: {
        id: 'response-1',
        timestamp: new Date(),
        modelId: 'mock-model',
        headers: {},
        messages: [
          { role: 'assistant', content: text },
        ],
      },
    }),
  });
}

/**
 * Helper to create a streaming mock model with multiple text deltas
 * Note: Model-level chunks use 'delta' for text-delta, not 'text'
 */
function createMultiDeltaStreamingMockModel(deltas: string[]) {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'text-start', id: 'text-1' },
          ...deltas.map(d => ({ type: 'text-delta' as const, id: 'text-1', delta: d })),
          { type: 'text-end', id: 'text-1' },
          {
            type: 'finish',
            finishReason: 'stop' as const,
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          },
        ],
      }),
      response: {
        id: 'response-1',
        timestamp: new Date(),
        modelId: 'mock-model',
        headers: {},
        messages: [
          { role: 'assistant', content: deltas.join('') },
        ],
      },
    }),
  });
}

/**
 * Helper to create a standard test input
 */
function createTestInput(overrides: Partial<AgentInput> = {}): AgentInput {
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
      conversationHistory: [],
      ipAddress: '127.0.0.1',
    },
    runId,
    messages: [
      { role: 'user', content: 'Hello' },
    ],
    tools: [],
    state: null,
    originalInput: {
      threadId,
      runId,
      messages: [{ id: uuidv4(), role: 'user', content: 'Hello' }],
      tools: [],
      state: null,
      context: [],
      forwardedProps: {},
    },
    ...overrides,
  };
}

describe('AISDKAgent', () => {
  test('implements Agent interface', () => {
    const mockModel = createStreamingTextMockModel('Default response');
    const agent = new AISDKAgent({ model: mockModel });

    expect(agent.getName()).toBe('ai-sdk');
    expect(typeof agent.run).toBe('function');
  });

  test('getName returns custom name when provided', () => {
    const mockModel = createStreamingTextMockModel('Default response');
    const agent = new AISDKAgent({ model: mockModel, name: 'claude' });

    expect(agent.getName()).toBe('claude');
  });

  test('run emits RUN_STARTED event', async () => {
    const mockModel = createStreamingTextMockModel('Hello');
    const agent = new AISDKAgent({ model: mockModel });

    const emittedEvents: AGUIEvent[] = [];
    const eventEmitter: EventEmitter = {
      emit: (event) => emittedEvents.push(event),
    };

    const input = createTestInput();
    await agent.run(input, eventEmitter);

    const runStartedEvent = emittedEvents.find(e => e.type === EventType.RUN_STARTED);
    expect(runStartedEvent).toBeDefined();
    expect((runStartedEvent as { runId: string }).runId).toBe(input.runId);
  });

  test('run emits TEXT_MESSAGE events for text response', async () => {
    const mockModel = createStreamingTextMockModel('Hello world');
    const agent = new AISDKAgent({ model: mockModel });

    const emittedEvents: AGUIEvent[] = [];
    const eventEmitter: EventEmitter = {
      emit: (event) => emittedEvents.push(event),
    };

    const input = createTestInput();
    await agent.run(input, eventEmitter);

    const textStart = emittedEvents.find(e => e.type === EventType.TEXT_MESSAGE_START);
    const textContent = emittedEvents.find(e => e.type === EventType.TEXT_MESSAGE_CONTENT);
    const textEnd = emittedEvents.find(e => e.type === EventType.TEXT_MESSAGE_END);

    expect(textStart).toBeDefined();
    expect(textContent).toBeDefined();
    expect(textEnd).toBeDefined();
    expect((textContent as { delta: string }).delta).toBe('Hello world');
  });

  test('run emits multiple TEXT_MESSAGE_CONTENT events for streaming deltas', async () => {
    const mockModel = createMultiDeltaStreamingMockModel(['Hello ', 'world', '!']);
    const agent = new AISDKAgent({ model: mockModel });

    const emittedEvents: AGUIEvent[] = [];
    const eventEmitter: EventEmitter = {
      emit: (event) => emittedEvents.push(event),
    };

    const input = createTestInput();
    await agent.run(input, eventEmitter);

    const textContentEvents = emittedEvents.filter(e => e.type === EventType.TEXT_MESSAGE_CONTENT);

    expect(textContentEvents.length).toBe(3);
    expect((textContentEvents[0] as { delta: string }).delta).toBe('Hello ');
    expect((textContentEvents[1] as { delta: string }).delta).toBe('world');
    expect((textContentEvents[2] as { delta: string }).delta).toBe('!');
  });

  test('run emits RUN_FINISHED event on success', async () => {
    const mockModel = createStreamingTextMockModel('Done');
    const agent = new AISDKAgent({ model: mockModel });

    const emittedEvents: AGUIEvent[] = [];
    const eventEmitter: EventEmitter = {
      emit: (event) => emittedEvents.push(event),
    };

    const input = createTestInput();
    const result = await agent.run(input, eventEmitter);

    expect(result.success).toBe(true);
    const runFinishedEvent = emittedEvents.find(e => e.type === EventType.RUN_FINISHED);
    expect(runFinishedEvent).toBeDefined();
  });

  test('run emits RUN_ERROR event on failure', async () => {
    const mockModel = new MockLanguageModelV3({
      doStream: async () => {
        throw new Error('API Error');
      },
    });

    const agent = new AISDKAgent({ model: mockModel });

    const emittedEvents: AGUIEvent[] = [];
    const eventEmitter: EventEmitter = {
      emit: (event) => emittedEvents.push(event),
    };

    const input = createTestInput();
    const result = await agent.run(input, eventEmitter);

    expect(result.success).toBe(false);
    expect(result.error).toBe('API Error');

    const runErrorEvent = emittedEvents.find(e => e.type === EventType.RUN_ERROR);
    expect(runErrorEvent).toBeDefined();
    expect((runErrorEvent as { message: string }).message).toBe(ErrorCode.UNKNOWN_ERROR);
  });

  test('run emits TOOL_CALL events when AI uses tools', async () => {
    const toolCallId = 'tool-call-123';
    const mockModel = new MockLanguageModelV3({
      doStream: async ({ tools }) => {
        // Check if tools are provided and create tool call stream
        const hasTools = tools && Object.keys(tools).length > 0;

        if (hasTools) {
          return {
            stream: simulateReadableStream({
              chunks: [
                { type: 'tool-input-start', id: toolCallId, toolName: 'test_tool' },
                { type: 'tool-input-delta', id: toolCallId, delta: '{"value":' },
                { type: 'tool-input-delta', id: toolCallId, delta: '"test"}' },
                { type: 'tool-input-end', id: toolCallId },
                { type: 'tool-call', toolCallId, toolName: 'test_tool', input: '{"value":"test"}' },
                {
                  type: 'finish',
                  finishReason: 'tool-calls',
                  usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
                },
              ],
            }),
            response: {
              id: 'response-1',
              timestamp: new Date(),
              modelId: 'mock-model',
              headers: {},
              messages: [
                {
                  role: 'assistant',
                  content: [
                    {
                      type: 'tool-call',
                      toolCallId,
                      toolName: 'test_tool',
                      input: { value: 'test' },
                    },
                  ],
                },
              ],
            },
          };
        }

        // Default text response
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'text-start', id: 'text-1' },
              { type: 'text-delta', id: 'text-1', delta: 'Done' },
              { type: 'text-end', id: 'text-1' },
              {
                type: 'finish',
                finishReason: 'stop',
                usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
              },
            ],
          }),
          response: {
            id: 'response-1',
            timestamp: new Date(),
            modelId: 'mock-model',
            headers: {},
            messages: [{ role: 'assistant', content: 'Done' }],
          },
        };
      },
    });

    const agent = new AISDKAgent({ model: mockModel });

    const emittedEvents: AGUIEvent[] = [];
    const eventEmitter: EventEmitter = {
      emit: (event) => {
        emittedEvents.push(event);
      },
    };

    const input = createTestInput({
      tools: [
        {
          name: 'test_tool',
          description: 'A test tool',
          parameters: {
            type: 'object',
            properties: {
              value: { type: 'string' },
            },
            required: ['value'],
          },
        },
      ],
    });

    // Start run in background
    const runPromise = agent.run(input, eventEmitter);

    // Wait for TOOL_CALL_END event and provide result
    await new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        const toolCallEnd = emittedEvents.find(e => e.type === EventType.TOOL_CALL_END);
        if (toolCallEnd) {
          clearInterval(checkInterval);

          // Simulate client sending tool result
          const receivedToolCallId = (toolCallEnd as { toolCallId: string }).toolCallId;
          const resolver = input.session.pendingToolCalls.get(receivedToolCallId);
          if (resolver) {
            resolver(JSON.stringify({ success: true }));
          }

          resolve();
        }
      }, 10);

      // Timeout after 5 seconds
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve();
      }, 5000);
    });

    // Verify tool call events were emitted
    const toolCallStart = emittedEvents.find(e => e.type === EventType.TOOL_CALL_START);
    const toolCallArgsEvents = emittedEvents.filter(e => e.type === EventType.TOOL_CALL_ARGS);
    const toolCallEnd = emittedEvents.find(e => e.type === EventType.TOOL_CALL_END);

    expect(toolCallStart).toBeDefined();
    expect((toolCallStart as { toolCallName: string }).toolCallName).toBe('test_tool');

    // Should have streamed args in deltas
    expect(toolCallArgsEvents.length).toBe(2);
    expect((toolCallArgsEvents[0] as { delta: string }).delta).toBe('{"value":');
    expect((toolCallArgsEvents[1] as { delta: string }).delta).toBe('"test"}');

    expect(toolCallEnd).toBeDefined();
  });

  test('run emits TOOL_CALL_ARGS when no streaming args (empty input tool)', async () => {
    // This test covers the fix for tools with no arguments where AI SDK skips
    // tool-input-delta events entirely. The agent should still emit TOOL_CALL_ARGS
    // with the complete args (empty object) when the tool-call event arrives.
    const toolCallId = 'tool-call-empty-args';
    let callCount = 0;
    const mockModel = new MockLanguageModelV3({
      doStream: async () => {
        callCount++;

        // First call: return tool call without streaming args
        if (callCount === 1) {
          return {
            stream: simulateReadableStream({
              chunks: [
                // Note: No tool-input-delta events - AI SDK skips streaming for empty args
                { type: 'tool-input-start', id: toolCallId, toolName: 'logout_tool' },
                { type: 'tool-input-end', id: toolCallId },
                // AI SDK tool-call chunk has input as string (JSON stringified)
                // See LanguageModelV3ToolCall type in @ai-sdk/provider
                { type: 'tool-call', toolCallId, toolName: 'logout_tool', input: '{}' },
                {
                  type: 'finish',
                  finishReason: 'tool-calls',
                  usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
                },
              ],
            }),
            response: {
              id: 'response-1',
              timestamp: new Date(),
              modelId: 'mock-model',
              headers: {},
              messages: [
                {
                  role: 'assistant',
                  content: [
                    {
                      type: 'tool-call',
                      toolCallId,
                      toolName: 'logout_tool',
                      input: {},
                    },
                  ],
                },
              ],
            },
          };
        }

        // Subsequent calls: return text response to complete the run
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'text-start', id: 'text-1' },
              { type: 'text-delta', id: 'text-1', delta: 'Logged out successfully' },
              { type: 'text-end', id: 'text-1' },
              {
                type: 'finish',
                finishReason: 'stop',
                usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
              },
            ],
          }),
          response: {
            id: 'response-1',
            timestamp: new Date(),
            modelId: 'mock-model',
            headers: {},
            messages: [{ role: 'assistant', content: 'Logged out successfully' }],
          },
        };
      },
    });

    const agent = new AISDKAgent({ model: mockModel });

    const emittedEvents: AGUIEvent[] = [];
    const eventEmitter: EventEmitter = {
      emit: (event) => {
        emittedEvents.push(event);
      },
    };

    const input = createTestInput({
      tools: [
        {
          name: 'logout_tool',
          description: 'Log the user out (no arguments)',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      ],
    });

    // Start run in background
    const runPromise = agent.run(input, eventEmitter);

    // Wait for TOOL_CALL_END event and provide result
    await new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        const toolCallEnd = emittedEvents.find(e => e.type === EventType.TOOL_CALL_END);
        if (toolCallEnd) {
          clearInterval(checkInterval);

          // Simulate client sending tool result
          const receivedToolCallId = (toolCallEnd as { toolCallId: string }).toolCallId;
          const resolver = input.session.pendingToolCalls.get(receivedToolCallId);
          if (resolver) {
            resolver(JSON.stringify({ success: true, message: 'Logged out' }));
          }

          resolve();
        }
      }, 10);

      // Timeout after 5 seconds
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve();
      }, 5000);
    });

    await runPromise;

    // Verify tool call events were emitted
    const toolCallStart = emittedEvents.find(e => e.type === EventType.TOOL_CALL_START);
    const toolCallArgsEvents = emittedEvents.filter(e => e.type === EventType.TOOL_CALL_ARGS);
    const toolCallEnd = emittedEvents.find(e => e.type === EventType.TOOL_CALL_END);

    expect(toolCallStart).toBeDefined();
    expect((toolCallStart as { toolCallName: string }).toolCallName).toBe('logout_tool');

    // Even though no tool-input-delta was streamed, we should still get one TOOL_CALL_ARGS
    // event with the complete args (empty object in this case)
    expect(toolCallArgsEvents.length).toBe(1);
    expect((toolCallArgsEvents[0] as { delta: string }).delta).toBe('{}');

    expect(toolCallEnd).toBeDefined();
  });

  test('agent updates conversation history', async () => {
    const mockModel = createStreamingTextMockModel('Response text');
    const agent = new AISDKAgent({ model: mockModel });

    const emittedEvents: AGUIEvent[] = [];
    const eventEmitter: EventEmitter = {
      emit: (event) => emittedEvents.push(event),
    };

    const session = {
      socket: {} as never,
      clientId: 'client-1',
      threadId: 'thread-1',
      tools: [] as never[],
      state: null,
      pendingToolCalls: new Map<string, (content: string) => void>(),
      conversationHistory: [] as never[],
      ipAddress: '127.0.0.1',
    };

    const input = createTestInput({ session: session as never });
    const result = await agent.run(input, eventEmitter);

    expect(result.success).toBe(true);
    expect(result.conversationHistory).toBeDefined();

    // Verify session conversationHistory was updated with at least the assistant response
    expect(session.conversationHistory.length).toBeGreaterThanOrEqual(1);
  });

  describe('Conversation history edge cases', () => {
    test('with stopWhen: response excludes input messages', async () => {
      // This test covers the case where AI SDK returns only NEW messages (not including input)
      // This is the typical behavior with stopWhen

      // Mock streamText to control response.messages
      const aiModule = await import('ai');
      const originalStreamText = aiModule.streamText;

      mock.module('ai', () => ({
        ...aiModule,
        streamText: (options: unknown) => {
          // Create a mock stream result
          const mockResult = {
            fullStream: (async function* () {
              yield { type: 'text-start', id: 'text-1' };
              yield { type: 'text-delta', id: 'text-1', text: 'Final response after tool execution' };
              yield { type: 'text-end', id: 'text-1' };
              yield {
                type: 'finish',
                finishReason: 'stop',
                usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
              };
            })(),
            response: Promise.resolve({
              id: 'response-1',
              timestamp: new Date(),
              modelId: 'mock-model',
              headers: {},
              messages: [
                // Only NEW messages (not including input)
                {
                  role: 'assistant',
                  content: [
                    {
                      type: 'tool-call',
                      toolCallId: 'call-123',
                      toolName: 'test_tool',
                      input: { value: 'test' },
                    },
                  ],
                },
                {
                  role: 'tool',
                  content: [
                    {
                      type: 'tool-result',
                      toolCallId: 'call-123',
                      toolName: 'test_tool',
                      output: { success: true },
                    },
                  ],
                },
                {
                  role: 'assistant',
                  content: 'Final response after tool execution',
                },
              ],
            }),
          };
          return mockResult;
        },
      }));

      const mockModel = createStreamingTextMockModel('Final response after tool execution');
      const agent = new AISDKAgent({ model: mockModel });

      const emittedEvents: AGUIEvent[] = [];
      const eventEmitter: EventEmitter = {
        emit: (event) => emittedEvents.push(event),
      };

      const session = {
        socket: {} as never,
        clientId: 'client-1',
        threadId: 'thread-1',
        tools: [] as never[],
        state: null,
        pendingToolCalls: new Map<string, (content: string) => void>(),
        conversationHistory: [] as never[],
        ipAddress: '127.0.0.1',
      };

      const input = createTestInput({ session: session as never });
      const result = await agent.run(input, eventEmitter);

      expect(result.success).toBe(true);

      // Verify all 3 new messages were added to conversation history
      expect(session.conversationHistory.length).toBe(3);
      expect((session.conversationHistory[0] as { role: string }).role).toBe('assistant');
      expect((session.conversationHistory[1] as { role: string }).role).toBe('tool');
      expect((session.conversationHistory[2] as { role: string }).role).toBe('assistant');

      // Verify the messages were sanitized (no extra fields)
      const assistantMsg = session.conversationHistory[0] as { content: unknown };
      expect(assistantMsg.content).toBeDefined();
      expect(Array.isArray(assistantMsg.content)).toBe(true);

      // Restore original
      mock.module('ai', () => ({
        ...aiModule,
        streamText: originalStreamText,
      }));
    });

    test('with single step: response includes input messages', async () => {
      // This test covers the case where AI SDK returns ALL messages (including input)
      // This may happen with single step or certain AI SDK versions

      // Mock streamText to return response that includes the input message
      const aiModule = await import('ai');
      const originalStreamText = aiModule.streamText;

      mock.module('ai', () => ({
        ...aiModule,
        streamText: (options: unknown) => {
          const mockResult = {
            fullStream: (async function* () {
              yield { type: 'text-start', id: 'text-1' };
              yield { type: 'text-delta', id: 'text-1', text: 'Final response after tool execution' };
              yield { type: 'text-end', id: 'text-1' };
              yield {
                type: 'finish',
                finishReason: 'stop',
                usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
              };
            })(),
            response: Promise.resolve({
              id: 'response-1',
              timestamp: new Date(),
              modelId: 'mock-model',
              headers: {},
              messages: [
                // Input message included - this is the key difference
                {
                  role: 'user',
                  content: 'Hello',
                },
                {
                  role: 'assistant',
                  content: [
                    {
                      type: 'tool-call',
                      toolCallId: 'call-456',
                      toolName: 'test_tool',
                      input: { value: 'test' },
                    },
                  ],
                },
                {
                  role: 'tool',
                  content: [
                    {
                      type: 'tool-result',
                      toolCallId: 'call-456',
                      toolName: 'test_tool',
                      output: { success: true },
                    },
                  ],
                },
                {
                  role: 'assistant',
                  content: 'Final response after tool execution',
                },
              ],
            }),
          };
          return mockResult;
        },
      }));

      const mockModel = createStreamingTextMockModel('Final response after tool execution');
      const agent = new AISDKAgent({ model: mockModel });

      const emittedEvents: AGUIEvent[] = [];
      const eventEmitter: EventEmitter = {
        emit: (event) => emittedEvents.push(event),
      };

      const session = {
        socket: {} as never,
        clientId: 'client-1',
        threadId: 'thread-1',
        tools: [] as never[],
        state: null,
        pendingToolCalls: new Map<string, (content: string) => void>(),
        conversationHistory: [] as never[],
        ipAddress: '127.0.0.1',
      };

      const input = createTestInput({ session: session as never });
      const result = await agent.run(input, eventEmitter);

      expect(result.success).toBe(true);

      // When response includes input and conversationHistory is empty, slice(0) returns all messages
      // So we expect all 4 messages to be added (including the user message)
      expect(session.conversationHistory.length).toBe(4);
      expect((session.conversationHistory[0] as { role: string }).role).toBe('user');
      expect((session.conversationHistory[1] as { role: string }).role).toBe('assistant');
      expect((session.conversationHistory[2] as { role: string }).role).toBe('tool');
      expect((session.conversationHistory[3] as { role: string }).role).toBe('assistant');

      // Restore original
      mock.module('ai', () => ({
        ...aiModule,
        streamText: originalStreamText,
      }));
    });

    test('preserves existing history across multiple turns', async () => {
      // This test verifies that conversation history accumulates correctly across multiple turns

      // Mock streamText to return a simple response with one assistant message
      const aiModule = await import('ai');
      const originalStreamText = aiModule.streamText;

      mock.module('ai', () => ({
        ...aiModule,
        streamText: (options: unknown) => {
          const mockResult = {
            fullStream: (async function* () {
              yield { type: 'text-start', id: 'text-1' };
              yield { type: 'text-delta', id: 'text-1', text: 'Response' };
              yield { type: 'text-end', id: 'text-1' };
              yield {
                type: 'finish',
                finishReason: 'stop',
                usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
              };
            })(),
            response: Promise.resolve({
              id: 'response-1',
              timestamp: new Date(),
              modelId: 'mock-model',
              headers: {},
              messages: [
                {
                  role: 'assistant',
                  content: 'Response',
                },
              ],
            }),
          };
          return mockResult;
        },
      }));

      const mockModel = createStreamingTextMockModel('Response');
      const agent = new AISDKAgent({ model: mockModel });

      const emittedEvents: AGUIEvent[] = [];
      const eventEmitter: EventEmitter = {
        emit: (event) => emittedEvents.push(event),
      };

      const session = {
        socket: {} as never,
        clientId: 'client-1',
        threadId: 'thread-1',
        tools: [] as never[],
        state: null,
        pendingToolCalls: new Map<string, (content: string) => void>(),
        conversationHistory: [
          { role: 'user', content: 'First message' },
          { role: 'assistant', content: 'First response' },
        ] as never[],
        ipAddress: '127.0.0.1',
      };

      const input = createTestInput({
        session: session as never,
        messages: [
          { role: 'user', content: 'First message' },
          { role: 'assistant', content: 'First response' },
          { role: 'user', content: 'Second message' },
        ],
      });

      const result = await agent.run(input, eventEmitter);

      expect(result.success).toBe(true);

      // Verify existing history is preserved and new message is added
      expect(session.conversationHistory.length).toBe(3);
      expect((session.conversationHistory[0] as { content: string }).content).toBe('First message');
      expect((session.conversationHistory[1] as { content: string }).content).toBe('First response');
      expect((session.conversationHistory[2] as { content: string }).content).toBe('Response');

      // Restore original
      mock.module('ai', () => ({
        ...aiModule,
        streamText: originalStreamText,
      }));
    });
  });

  describe('Streaming-specific tests', () => {
    test('emits STEP_STARTED and STEP_FINISHED events', async () => {
      // Note: Model-level chunks don't have 'start-step'/'finish-step' - those are emitted by streamText
      // We need to use the model-level chunk format with 'stream-start'
      const mockModel = new MockLanguageModelV3({
        doStream: async () => ({
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start', warnings: [] },
              { type: 'text-start', id: 'text-1' },
              { type: 'text-delta', id: 'text-1', delta: 'Hello' },
              { type: 'text-end', id: 'text-1' },
              {
                type: 'finish',
                finishReason: 'stop',
                usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
              },
            ],
          }),
          response: {
            id: 'response-1',
            timestamp: new Date(),
            modelId: 'mock-model',
            headers: {},
            messages: [{ role: 'assistant', content: 'Hello' }],
          },
        }),
      });

      const agent = new AISDKAgent({ model: mockModel });

      const emittedEvents: AGUIEvent[] = [];
      const eventEmitter: EventEmitter = {
        emit: (event) => emittedEvents.push(event),
      };

      const input = createTestInput();
      await agent.run(input, eventEmitter);

      const stepStarted = emittedEvents.find(e => e.type === EventType.STEP_STARTED);
      const stepFinished = emittedEvents.find(e => e.type === EventType.STEP_FINISHED);

      expect(stepStarted).toBeDefined();
      expect((stepStarted as { stepName: string }).stepName).toBe('step-0');

      expect(stepFinished).toBeDefined();
      expect((stepFinished as { stepName: string }).stepName).toBe('step-0');
    });

    test('handles error chunk in stream', async () => {
      const mockModel = new MockLanguageModelV3({
        doStream: async () => ({
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start', warnings: [] },
              { type: 'text-start', id: 'text-1' },
              { type: 'error', error: new Error('Stream error') },
            ],
          }),
          response: {
            id: 'response-1',
            timestamp: new Date(),
            modelId: 'mock-model',
            headers: {},
            messages: [],
          },
        }),
      });

      const agent = new AISDKAgent({ model: mockModel });

      const emittedEvents: AGUIEvent[] = [];
      const eventEmitter: EventEmitter = {
        emit: (event) => emittedEvents.push(event),
      };

      const input = createTestInput();
      const result = await agent.run(input, eventEmitter);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Stream error');

      const runErrorEvent = emittedEvents.find(e => e.type === EventType.RUN_ERROR);
      expect(runErrorEvent).toBeDefined();
    });

    test('handles empty response (no text, no tool calls)', async () => {
      const mockModel = new MockLanguageModelV3({
        doStream: async () => ({
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start', warnings: [] },
              {
                type: 'finish',
                finishReason: 'stop',
                usage: { inputTokens: 10, outputTokens: 0, totalTokens: 10 },
              },
            ],
          }),
          response: {
            id: 'response-1',
            timestamp: new Date(),
            modelId: 'mock-model',
            headers: {},
            messages: [],
          },
        }),
      });

      const agent = new AISDKAgent({ model: mockModel });

      const emittedEvents: AGUIEvent[] = [];
      const eventEmitter: EventEmitter = {
        emit: (event) => emittedEvents.push(event),
      };

      const input = createTestInput();
      const result = await agent.run(input, eventEmitter);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Empty response from AI');

      const runErrorEvent = emittedEvents.find(e => e.type === EventType.RUN_ERROR);
      expect(runErrorEvent).toBeDefined();
      expect((runErrorEvent as { message: string }).message).toContain('empty response');
    });
  });

  describe('System prompt configuration', () => {
    /**
     * Helper to create a mock model that captures the system messages passed to it
     */
    function createSystemMessageCapturingMockModel(capturedMessages: { values: Array<{ role: string; content: string }> }) {
      return new MockLanguageModelV3({
        doStream: async ({ prompt }) => {
          // Find all system messages in the prompt
          // System messages have content as string, so we can safely cast
          const systemMessages = prompt.filter((msg) => msg.role === 'system') as Array<{ role: string; content: string }>;
          capturedMessages.values = systemMessages.map((msg) => ({
            role: msg.role,
            content: msg.content,
          }));

          return {
            stream: simulateReadableStream({
              chunks: [
                { type: 'text-start', id: 'text-1' },
                { type: 'text-delta', id: 'text-1', delta: 'Done' },
                { type: 'text-end', id: 'text-1' },
                { type: 'finish', finishReason: 'stop', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
              ],
            }),
            response: {
              id: 'response-1',
              timestamp: new Date(),
              modelId: 'mock-model',
              headers: {},
              messages: [{ role: 'assistant', content: 'Done' }],
            },
          };
        },
      });
    }

    test('uses config systemPrompt when provided', async () => {
      const capturedMessages = { values: [] as Array<{ role: string; content: string }> };
      const mockModel = createSystemMessageCapturingMockModel(capturedMessages);

      const agent = new AISDKAgent({
        model: mockModel,
        systemPrompt: 'You are a helpful assistant.',
      });

      const emittedEvents: AGUIEvent[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      const input = createTestInput();
      const result = await agent.run(input, eventEmitter);

      expect(result.success).toBe(true);
      expect(capturedMessages.values.length).toBe(1);
      expect(capturedMessages.values[0].content).toBe('You are a helpful assistant.');
    });

    test('sends config and runtime systemPrompts as separate messages', async () => {
      const capturedMessages = { values: [] as Array<{ role: string; content: string }> };
      const mockModel = createSystemMessageCapturingMockModel(capturedMessages);

      const agent = new AISDKAgent({
        model: mockModel,
        systemPrompt: 'You are a helpful assistant.',
      });

      const emittedEvents: AGUIEvent[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      const input = createTestInput({
        systemPrompt: 'Current state: {"todos": []}',
      });
      const result = await agent.run(input, eventEmitter);

      expect(result.success).toBe(true);
      // Config prompt and runtime prompt are sent as separate system messages
      expect(capturedMessages.values.length).toBe(2);
      expect(capturedMessages.values[0].role).toBe('system');
      expect(capturedMessages.values[0].content).toBe('You are a helpful assistant.');
      expect(capturedMessages.values[1].role).toBe('system');
      expect(capturedMessages.values[1].content).toBe('Current state: {"todos": []}');
    });

    test('uses only runtime systemPrompt when config is not set', async () => {
      const capturedMessages = { values: [] as Array<{ role: string; content: string }> };
      const mockModel = createSystemMessageCapturingMockModel(capturedMessages);

      const agent = new AISDKAgent({
        model: mockModel,
        // No systemPrompt in config
      });

      const emittedEvents: AGUIEvent[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      const input = createTestInput({
        systemPrompt: 'Current state: {"todos": []}',
      });
      const result = await agent.run(input, eventEmitter);

      expect(result.success).toBe(true);
      expect(capturedMessages.values.length).toBe(1);
      expect(capturedMessages.values[0].content).toBe('Current state: {"todos": []}');
    });

    test('no systemPrompt when both config and runtime are undefined', async () => {
      const capturedMessages = { values: [] as Array<{ role: string; content: string }> };
      const mockModel = createSystemMessageCapturingMockModel(capturedMessages);

      const agent = new AISDKAgent({
        model: mockModel,
      });

      const emittedEvents: AGUIEvent[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      const input = createTestInput();
      const result = await agent.run(input, eventEmitter);

      expect(result.success).toBe(true);
      expect(capturedMessages.values.length).toBe(0);
    });

    test('supports function-based systemPrompt for dynamic resolution', async () => {
      const capturedMessages = { values: [] as Array<{ role: string; content: string }> };
      const mockModel = createSystemMessageCapturingMockModel(capturedMessages);

      // Simulate a dynamic prompt that could be fetched from Langfuse or other sources
      let dynamicPromptValue = 'Initial prompt';
      const agent = new AISDKAgent({
        model: mockModel,
        systemPrompt: () => dynamicPromptValue,
      });

      const emittedEvents: AGUIEvent[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      // First run with initial prompt
      const input1 = createTestInput();
      await agent.run(input1, eventEmitter);

      expect(capturedMessages.values.length).toBe(1);
      expect(capturedMessages.values[0].content).toBe('Initial prompt');

      // Update the dynamic prompt value (simulating Langfuse update)
      dynamicPromptValue = 'Updated prompt from Langfuse';

      // Second run should use the updated prompt without server restart
      const input2 = createTestInput();
      await agent.run(input2, eventEmitter);

      expect(capturedMessages.values.length).toBe(1);
      expect(capturedMessages.values[0].content).toBe('Updated prompt from Langfuse');
    });

    test('function-based systemPrompt returning empty string is skipped', async () => {
      const capturedMessages = { values: [] as Array<{ role: string; content: string }> };
      const mockModel = createSystemMessageCapturingMockModel(capturedMessages);

      const agent = new AISDKAgent({
        model: mockModel,
        systemPrompt: () => '',
      });

      const emittedEvents: AGUIEvent[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      const input = createTestInput({
        systemPrompt: 'Runtime prompt only',
      });
      const result = await agent.run(input, eventEmitter);

      expect(result.success).toBe(true);
      // Only runtime prompt should be present since function returned empty string
      expect(capturedMessages.values.length).toBe(1);
      expect(capturedMessages.values[0].content).toBe('Runtime prompt only');
    });

    test('supports async function-based systemPrompt', async () => {
      const capturedMessages = { values: [] as Array<{ role: string; content: string }> };
      const mockModel = createSystemMessageCapturingMockModel(capturedMessages);

      // Simulate fetching from Langfuse or other async source
      const agent = new AISDKAgent({
        model: mockModel,
        systemPrompt: async () => {
          // Simulate async operation (e.g., Langfuse API call)
          await new Promise((resolve) => setTimeout(resolve, 10));
          return 'Async prompt from Langfuse';
        },
      });

      const emittedEvents: AGUIEvent[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      const input = createTestInput();
      const result = await agent.run(input, eventEmitter);

      expect(result.success).toBe(true);
      expect(capturedMessages.values.length).toBe(1);
      expect(capturedMessages.values[0].content).toBe('Async prompt from Langfuse');
    });

    test('async systemPrompt is resolved fresh on each run', async () => {
      const capturedMessages = { values: [] as Array<{ role: string; content: string }> };
      const mockModel = createSystemMessageCapturingMockModel(capturedMessages);

      // Simulate a prompt that changes over time (like Langfuse updates)
      let promptVersion = 1;
      const agent = new AISDKAgent({
        model: mockModel,
        systemPrompt: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return `Prompt version ${promptVersion}`;
        },
      });

      const emittedEvents: AGUIEvent[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      // First run
      await agent.run(createTestInput(), eventEmitter);
      expect(capturedMessages.values[0].content).toBe('Prompt version 1');

      // Update the prompt (simulating Langfuse update)
      promptVersion = 2;

      // Second run should get the updated prompt
      await agent.run(createTestInput(), eventEmitter);
      expect(capturedMessages.values[0].content).toBe('Prompt version 2');
    });

    test('async systemPrompt returning empty string is skipped', async () => {
      const capturedMessages = { values: [] as Array<{ role: string; content: string }> };
      const mockModel = createSystemMessageCapturingMockModel(capturedMessages);

      const agent = new AISDKAgent({
        model: mockModel,
        systemPrompt: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return '';
        },
      });

      const emittedEvents: AGUIEvent[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      const input = createTestInput({
        systemPrompt: 'Runtime prompt only',
      });
      const result = await agent.run(input, eventEmitter);

      expect(result.success).toBe(true);
      expect(capturedMessages.values.length).toBe(1);
      expect(capturedMessages.values[0].content).toBe('Runtime prompt only');
    });
  });

  describe('Tool filtering', () => {
    /**
     * Helper to create a mock MCP (remote) tool with the _remote property
     */
    function createMcpTool(name: string, description: string = `MCP tool: ${name}`): RemoteToolDefinition {
      return {
        name,
        description,
        parameters: { type: 'object', properties: {}, required: [] },
        _remote: {
          provider: {
            executeTool: mock(() => Promise.resolve({ success: true })),
          } as unknown as RemoteToolDefinition['_remote']['provider'],
          originalName: name,
        },
      };
    }

    /**
     * Helper to create a mock client tool (no _remote property)
     */
    function createClientTool(name: string, description: string = `Client tool: ${name}`): ToolDefinition {
      return {
        name,
        description,
        parameters: { type: 'object', properties: {}, required: [] },
      };
    }

    /**
     * Helper to create a mock model that captures the tool names passed to it
     */
    function createToolCapturingMockModel(capturedTools: { names: string[] }) {
      return new MockLanguageModelV3({
        doStream: async ({ tools }) => {
          // Capture tool names - tools is an object with tool definitions
          // The keys may be numeric indices, so we need to extract names from values
          if (tools) {
            capturedTools.names = Object.values(tools).map((t: { name?: string }) => t.name || 'unknown');
          }

          return {
            stream: simulateReadableStream({
              chunks: [
                { type: 'text-start', id: 'text-1' },
                { type: 'text-delta', id: 'text-1', delta: 'Done' },
                { type: 'text-end', id: 'text-1' },
                { type: 'finish', finishReason: 'stop', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
              ],
            }),
            response: {
              id: 'response-1',
              timestamp: new Date(),
              modelId: 'mock-model',
              headers: {},
              messages: [{ role: 'assistant', content: 'Done' }],
            },
          };
        },
      });
    }

    test('no filtering: all tools are included', async () => {
      const capturedTools = { names: [] as string[] };
      const mockModel = createToolCapturingMockModel(capturedTools);

      // No toolFilter specified
      const agent = new AISDKAgent({ model: mockModel });

      const emittedEvents: AGUIEvent[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      const input = createTestInput({
        tools: [
          createMcpTool('db_query'),
          createMcpTool('admin_delete'),
          createClientTool('client_tool'),
        ],
      });

      const result = await agent.run(input, eventEmitter);
      expect(result.success).toBe(true);
      expect(capturedTools.names.sort()).toEqual(['admin_delete', 'client_tool', 'db_query']);
    });

    test('glob pattern filtering: only matching tools are included', async () => {
      const capturedTools = { names: [] as string[] };
      const mockModel = createToolCapturingMockModel(capturedTools);

      const agent = new AISDKAgent({
        model: mockModel,
        // Filter to only allow tools matching 'db_*' pattern
        toolFilter: createGlobFilter(['db_*']),
      });

      const emittedEvents: AGUIEvent[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      const input = createTestInput({
        tools: [
          createMcpTool('db_query'),
          createMcpTool('db_read'),
          createMcpTool('admin_delete'),
          createMcpTool('file_write'),
          createClientTool('client_tool'),
        ],
      });

      const result = await agent.run(input, eventEmitter);
      expect(result.success).toBe(true);
      // Only db_* tools should be included (client_tool is also filtered out by glob)
      expect(capturedTools.names.sort()).toEqual(['db_query', 'db_read']);
    });

    test('and combinator: combining multiple conditions', async () => {
      const capturedTools = { names: [] as string[] };
      const mockModel = createToolCapturingMockModel(capturedTools);

      const agent = new AISDKAgent({
        model: mockModel,
        // Tools matching 'db_*' AND is MCP tool (exclude client tools)
        toolFilter: and(
          createGlobFilter(['db_*']),
          isRemoteTool
        ),
      });

      const emittedEvents: AGUIEvent[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      const input = createTestInput({
        tools: [
          createMcpTool('db_query'),
          createMcpTool('db_read'),
          createMcpTool('admin_delete'),
          createClientTool('db_client_tool'),  // Matches glob but is not MCP
          createClientTool('client_tool'),
        ],
      });

      const result = await agent.run(input, eventEmitter);
      expect(result.success).toBe(true);
      // Only MCP tools matching db_* (client tools excluded by isRemoteTool condition)
      expect(capturedTools.names.sort()).toEqual(['db_query', 'db_read']);
    });

    test('or combinator: multiple glob patterns', async () => {
      const capturedTools = { names: [] as string[] };
      const mockModel = createToolCapturingMockModel(capturedTools);

      const agent = new AISDKAgent({
        model: mockModel,
        // Tools matching either 'db_*' OR 'file_*'
        toolFilter: or(
          createGlobFilter(['db_*']),
          createGlobFilter(['file_*'])
        ),
      });

      const emittedEvents: AGUIEvent[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      const input = createTestInput({
        tools: [
          createMcpTool('db_query'),
          createMcpTool('file_read'),
          createMcpTool('file_write'),
          createMcpTool('admin_delete'),
          createClientTool('client_tool'),
        ],
      });

      const result = await agent.run(input, eventEmitter);
      expect(result.success).toBe(true);
      // Tools matching db_* OR file_* (client_tool excluded by glob filters)
      expect(capturedTools.names.sort()).toEqual(['db_query', 'file_read', 'file_write']);
    });

    test('not combinator: exclude matching patterns', async () => {
      const capturedTools = { names: [] as string[] };
      const mockModel = createToolCapturingMockModel(capturedTools);

      const agent = new AISDKAgent({
        model: mockModel,
        // Exclude tools matching 'admin_*' or 'delete_*'
        toolFilter: not(
          or(
            createGlobFilter(['admin_*']),
            createGlobFilter(['*_delete'])
          )
        ),
      });

      const emittedEvents: AGUIEvent[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      const input = createTestInput({
        tools: [
          createMcpTool('db_query'),
          createMcpTool('db_read'),
          createMcpTool('db_delete'),
          createMcpTool('admin_restart'),
          createClientTool('client_tool'),
        ],
      });

      const result = await agent.run(input, eventEmitter);
      expect(result.success).toBe(true);
      // admin_* and *_delete excluded
      expect(capturedTools.names.sort()).toEqual(['client_tool', 'db_query', 'db_read']);
    });
  });

  describe('Prompt caching (cacheBreakpoint)', () => {
    /**
     * Helper to create a mock stream result with captured messages
     */
    function createMockStreamResult(capturedMessages: { messages: unknown[] }) {
      return (options: { messages: unknown[] }) => {
        capturedMessages.messages = options.messages;
        return {
          fullStream: (async function* () {
            yield { type: 'text-start', id: 'text-1' };
            yield { type: 'text-delta', id: 'text-1', text: 'Response' };
            yield { type: 'text-end', id: 'text-1' };
            yield {
              type: 'finish',
              finishReason: 'stop',
              usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
            };
          })(),
          response: Promise.resolve({
            id: 'response-1',
            timestamp: new Date(),
            modelId: 'claude-3-5-sonnet-20241022',
            headers: {},
            messages: [{ role: 'assistant', content: 'Response' }],
          }),
        };
      };
    }

    /**
     * Helper to create a mock Anthropic model
     */
    function createAnthropicMockModel() {
      return new MockLanguageModelV3({
        provider: 'anthropic',
        modelId: 'claude-3-5-sonnet-20241022',
        doStream: async () => ({
          stream: simulateReadableStream({
            chunks: [
              { type: 'text-start', id: 'text-1' },
              { type: 'text-delta', id: 'text-1', delta: 'Response' },
              { type: 'text-end', id: 'text-1' },
              { type: 'finish', finishReason: 'stop', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
            ],
          }),
          response: {
            id: 'response-1',
            timestamp: new Date(),
            modelId: 'claude-3-5-sonnet-20241022',
            headers: {},
            messages: [{ role: 'assistant', content: 'Response' }],
          },
        }),
      });
    }

    /**
     * Helper to create a non-Anthropic mock model
     */
    function createNonAnthropicMockModel() {
      return new MockLanguageModelV3({
        provider: 'openai',
        modelId: 'gpt-4-turbo',
        doStream: async () => ({
          stream: simulateReadableStream({
            chunks: [
              { type: 'text-start', id: 'text-1' },
              { type: 'text-delta', id: 'text-1', delta: 'Response' },
              { type: 'text-end', id: 'text-1' },
              { type: 'finish', finishReason: 'stop', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
            ],
          }),
          response: {
            id: 'response-1',
            timestamp: new Date(),
            modelId: 'gpt-4-turbo',
            headers: {},
            messages: [{ role: 'assistant', content: 'Response' }],
          },
        }),
      });
    }

    test('no cacheBreakpoint: messages are not modified', async () => {
      const capturedMessages = { messages: [] as unknown[] };
      const aiModule = await import('ai');
      const originalStreamText = aiModule.streamText;

      mock.module('ai', () => ({
        ...aiModule,
        streamText: createMockStreamResult(capturedMessages),
      }));

      const mockModel = createAnthropicMockModel();
      const agent = new AISDKAgent({ model: mockModel });

      const emittedEvents: AGUIEvent[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      const input = createTestInput({
        systemPrompt: 'You are a helpful assistant.',
      });

      await agent.run(input, eventEmitter);

      // Messages should not have providerOptions
      const hasProviderOptions = capturedMessages.messages.some(
        (msg: unknown) => (msg as { providerOptions?: unknown }).providerOptions
      );
      expect(hasProviderOptions).toBe(false);

      mock.module('ai', () => ({
        ...aiModule,
        streamText: originalStreamText,
      }));
    });

    test('cacheBreakpoint with isLast: adds cache control to last message', async () => {
      const capturedMessages = { messages: [] as unknown[] };
      const aiModule = await import('ai');
      const originalStreamText = aiModule.streamText;

      mock.module('ai', () => ({
        ...aiModule,
        streamText: createMockStreamResult(capturedMessages),
      }));

      const mockModel = createAnthropicMockModel();
      const agent = new AISDKAgent({
        model: mockModel,
        cacheBreakpoint: (msg) => msg.isLast,
      });

      const emittedEvents: AGUIEvent[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      const input = createTestInput({
        systemPrompt: 'You are a helpful assistant.',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
          { role: 'user', content: 'How are you?' },
        ],
      });

      await agent.run(input, eventEmitter);

      // Should have 4 messages: system + 3 user/assistant messages
      expect(capturedMessages.messages.length).toBe(4);

      // Only the last message should have providerOptions
      const messagesWithCache = capturedMessages.messages.filter(
        (msg: unknown) => (msg as { providerOptions?: unknown }).providerOptions
      );
      expect(messagesWithCache.length).toBe(1);

      // Verify it's the last message
      const lastMsg = capturedMessages.messages[3] as { role: string; providerOptions?: { anthropic?: { cacheControl?: { type: string } } } };
      expect(lastMsg.role).toBe('user');
      expect(lastMsg.providerOptions?.anthropic?.cacheControl?.type).toBe('ephemeral');

      mock.module('ai', () => ({
        ...aiModule,
        streamText: originalStreamText,
      }));
    });

    test('cacheBreakpoint with system role: adds cache control to system prompt', async () => {
      const capturedMessages = { messages: [] as unknown[] };
      const aiModule = await import('ai');
      const originalStreamText = aiModule.streamText;

      mock.module('ai', () => ({
        ...aiModule,
        streamText: createMockStreamResult(capturedMessages),
      }));

      const mockModel = createAnthropicMockModel();
      const agent = new AISDKAgent({
        model: mockModel,
        cacheBreakpoint: (msg) => msg.role === 'system',
      });

      const emittedEvents: AGUIEvent[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      const input = createTestInput({
        systemPrompt: 'You are a helpful assistant.',
      });

      await agent.run(input, eventEmitter);

      // First message should be system with cache control
      const systemMsg = capturedMessages.messages[0] as { role: string; providerOptions?: { anthropic?: { cacheControl?: { type: string } } } };
      expect(systemMsg.role).toBe('system');
      expect(systemMsg.providerOptions?.anthropic?.cacheControl?.type).toBe('ephemeral');

      // User message should not have cache control
      const userMsg = capturedMessages.messages[1] as { role: string; providerOptions?: unknown };
      expect(userMsg.role).toBe('user');
      expect(userMsg.providerOptions).toBeUndefined();

      mock.module('ai', () => ({
        ...aiModule,
        streamText: originalStreamText,
      }));
    });

    test('cacheBreakpoint with system OR isLast: common caching pattern', async () => {
      const capturedMessages = { messages: [] as unknown[] };
      const aiModule = await import('ai');
      const originalStreamText = aiModule.streamText;

      mock.module('ai', () => ({
        ...aiModule,
        streamText: createMockStreamResult(capturedMessages),
      }));

      const mockModel = createAnthropicMockModel();
      const agent = new AISDKAgent({
        model: mockModel,
        cacheBreakpoint: (msg) => msg.role === 'system' || msg.isLast,
      });

      const emittedEvents: AGUIEvent[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      const input = createTestInput({
        systemPrompt: 'You are a helpful assistant.',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
          { role: 'user', content: 'How are you?' },
        ],
      });

      await agent.run(input, eventEmitter);

      // Should have 4 messages: system + 3 user/assistant messages
      expect(capturedMessages.messages.length).toBe(4);

      // System and last message should have cache control
      const messagesWithCache = capturedMessages.messages.filter(
        (msg: unknown) => (msg as { providerOptions?: unknown }).providerOptions
      );
      expect(messagesWithCache.length).toBe(2);

      // Verify system message has cache control
      const systemMsg = capturedMessages.messages[0] as { role: string; providerOptions?: { anthropic?: { cacheControl?: { type: string } } } };
      expect(systemMsg.role).toBe('system');
      expect(systemMsg.providerOptions?.anthropic?.cacheControl?.type).toBe('ephemeral');

      // Verify last message has cache control
      const lastMsg = capturedMessages.messages[3] as { role: string; providerOptions?: { anthropic?: { cacheControl?: { type: string } } } };
      expect(lastMsg.providerOptions?.anthropic?.cacheControl?.type).toBe('ephemeral');

      mock.module('ai', () => ({
        ...aiModule,
        streamText: originalStreamText,
      }));
    });

    test('cacheBreakpoint with index: adds cache control to first N messages', async () => {
      const capturedMessages = { messages: [] as unknown[] };
      const aiModule = await import('ai');
      const originalStreamText = aiModule.streamText;

      mock.module('ai', () => ({
        ...aiModule,
        streamText: createMockStreamResult(capturedMessages),
      }));

      const mockModel = createAnthropicMockModel();
      const agent = new AISDKAgent({
        model: mockModel,
        // Cache first 2 messages (system + first user)
        cacheBreakpoint: (msg) => msg.index < 2,
      });

      const emittedEvents: AGUIEvent[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      const input = createTestInput({
        systemPrompt: 'You are a helpful assistant.',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
          { role: 'user', content: 'How are you?' },
        ],
      });

      await agent.run(input, eventEmitter);

      // First 2 messages should have cache control
      const msg0 = capturedMessages.messages[0] as { providerOptions?: unknown };
      const msg1 = capturedMessages.messages[1] as { providerOptions?: unknown };
      const msg2 = capturedMessages.messages[2] as { providerOptions?: unknown };
      const msg3 = capturedMessages.messages[3] as { providerOptions?: unknown };

      expect(msg0.providerOptions).toBeDefined();
      expect(msg1.providerOptions).toBeDefined();
      expect(msg2.providerOptions).toBeUndefined();
      expect(msg3.providerOptions).toBeUndefined();

      mock.module('ai', () => ({
        ...aiModule,
        streamText: originalStreamText,
      }));
    });

    test('cacheBreakpoint receives correct context', async () => {
      const mockModel = createAnthropicMockModel();

      const receivedContexts: Array<{
        role: string;
        index: number;
        totalCount: number;
        isFirst: boolean;
        isLast: boolean;
      }> = [];

      const agent = new AISDKAgent({
        model: mockModel,
        cacheBreakpoint: (msg) => {
          receivedContexts.push({
            role: msg.role,
            index: msg.index,
            totalCount: msg.totalCount,
            isFirst: msg.isFirst,
            isLast: msg.isLast,
          });
          return false;
        },
      });

      const emittedEvents: AGUIEvent[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      const input = createTestInput({
        systemPrompt: 'System prompt',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi!' },
        ],
      });

      await agent.run(input, eventEmitter);

      // Should have received context for 3 messages
      expect(receivedContexts.length).toBe(3);

      // Verify system message context
      expect(receivedContexts[0]).toEqual({
        role: 'system',
        index: 0,
        totalCount: 3,
        isFirst: true,
        isLast: false,
      });

      // Verify user message context
      expect(receivedContexts[1]).toEqual({
        role: 'user',
        index: 1,
        totalCount: 3,
        isFirst: false,
        isLast: false,
      });

      // Verify assistant message context
      expect(receivedContexts[2]).toEqual({
        role: 'assistant',
        index: 2,
        totalCount: 3,
        isFirst: false,
        isLast: true,
      });
    });

    test('cacheBreakpoint not applied for non-Anthropic models', async () => {
      const capturedMessages = { messages: [] as unknown[] };
      const aiModule = await import('ai');
      const originalStreamText = aiModule.streamText;

      mock.module('ai', () => ({
        ...aiModule,
        streamText: createMockStreamResult(capturedMessages),
      }));

      const mockModel = createNonAnthropicMockModel();
      const agent = new AISDKAgent({
        model: mockModel,
        // This would add cache control for Anthropic, but should be ignored for other models
        cacheBreakpoint: (msg) => msg.isLast,
      });

      const emittedEvents: AGUIEvent[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      const input = createTestInput({
        systemPrompt: 'You are a helpful assistant.',
      });

      await agent.run(input, eventEmitter);

      // No messages should have providerOptions since it's not an Anthropic model
      const hasProviderOptions = capturedMessages.messages.some(
        (msg: unknown) => (msg as { providerOptions?: unknown }).providerOptions
      );
      expect(hasProviderOptions).toBe(false);

      mock.module('ai', () => ({
        ...aiModule,
        streamText: originalStreamText,
      }));
    });

    test('cacheBreakpoint works without system prompt', async () => {
      const capturedMessages = { messages: [] as unknown[] };
      const aiModule = await import('ai');
      const originalStreamText = aiModule.streamText;

      mock.module('ai', () => ({
        ...aiModule,
        streamText: createMockStreamResult(capturedMessages),
      }));

      const mockModel = createAnthropicMockModel();
      const agent = new AISDKAgent({
        model: mockModel,
        cacheBreakpoint: (msg) => msg.isLast,
      });

      const emittedEvents: AGUIEvent[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      // No system prompt
      const input = createTestInput({
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
        ],
      });

      await agent.run(input, eventEmitter);

      // Should have 2 messages (no system prompt)
      expect(capturedMessages.messages.length).toBe(2);

      // Only the last message should have cache control
      const lastMsg = capturedMessages.messages[1] as { role: string; providerOptions?: { anthropic?: { cacheControl?: { type: string } } } };
      expect(lastMsg.role).toBe('assistant');
      expect(lastMsg.providerOptions?.anthropic?.cacheControl?.type).toBe('ephemeral');

      mock.module('ai', () => ({
        ...aiModule,
        streamText: originalStreamText,
      }));
    });

    test('system message is not stored in conversation history', async () => {
      // Mock streamText to return response that includes system message
      const aiModule = await import('ai');
      const originalStreamText = aiModule.streamText;

      mock.module('ai', () => ({
        ...aiModule,
        streamText: () => {
          return {
            fullStream: (async function* () {
              yield { type: 'text-start', id: 'text-1' };
              yield { type: 'text-delta', id: 'text-1', text: 'Response' };
              yield { type: 'text-end', id: 'text-1' };
              yield {
                type: 'finish',
                finishReason: 'stop',
                usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
              };
            })(),
            response: Promise.resolve({
              id: 'response-1',
              timestamp: new Date(),
              modelId: 'claude-3-5-sonnet-20241022',
              headers: {},
              messages: [
                // Response includes system message (which should be filtered out)
                { role: 'system', content: 'You are a helpful assistant.' },
                { role: 'assistant', content: 'Response' },
              ],
            }),
          };
        },
      }));

      const mockModel = createAnthropicMockModel();
      const agent = new AISDKAgent({
        model: mockModel,
        cacheBreakpoint: (msg) => msg.role === 'system',
      });

      const emittedEvents: AGUIEvent[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      const session = {
        socket: {} as never,
        clientId: 'client-1',
        threadId: 'thread-1',
        tools: [] as never[],
        state: null,
        pendingToolCalls: new Map<string, (content: string) => void>(),
        conversationHistory: [] as never[],
        ipAddress: '127.0.0.1',
      };

      const input = createTestInput({
        session: session as never,
        systemPrompt: 'You are a helpful assistant.',
      });

      await agent.run(input, eventEmitter);

      // Conversation history should NOT contain system message
      const hasSystemMessage = session.conversationHistory.some(
        (msg: unknown) => (msg as { role: string }).role === 'system'
      );
      expect(hasSystemMessage).toBe(false);

      // Should only contain the assistant response
      expect(session.conversationHistory.length).toBe(1);
      expect((session.conversationHistory[0] as { role: string }).role).toBe('assistant');

      // Restore original
      mock.module('ai', () => ({
        ...aiModule,
        streamText: originalStreamText,
      }));
    });

    test('cacheBreakpoint with TTL string: adds cache control with explicit TTL', async () => {
      const capturedMessages = { messages: [] as unknown[] };
      const aiModule = await import('ai');
      const originalStreamText = aiModule.streamText;

      mock.module('ai', () => ({
        ...aiModule,
        streamText: createMockStreamResult(capturedMessages),
      }));

      const mockModel = createAnthropicMockModel();
      const agent = new AISDKAgent({
        model: mockModel,
        // Return '1h' TTL for system prompt
        cacheBreakpoint: (msg) => msg.role === 'system' ? '1h' : false,
      });

      const emittedEvents: AGUIEvent[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      const input = createTestInput({
        systemPrompt: 'You are a helpful assistant.',
      });

      await agent.run(input, eventEmitter);

      // System message should have cache control with TTL
      const systemMsg = capturedMessages.messages[0] as {
        role: string;
        providerOptions?: { anthropic?: { cacheControl?: { type: string; ttl?: string } } }
      };
      expect(systemMsg.role).toBe('system');
      expect(systemMsg.providerOptions?.anthropic?.cacheControl?.type).toBe('ephemeral');
      expect(systemMsg.providerOptions?.anthropic?.cacheControl?.ttl).toBe('1h');

      mock.module('ai', () => ({
        ...aiModule,
        streamText: originalStreamText,
      }));
    });

    test('cacheBreakpoint with different TTLs for different messages', async () => {
      const capturedMessages = { messages: [] as unknown[] };
      const aiModule = await import('ai');
      const originalStreamText = aiModule.streamText;

      mock.module('ai', () => ({
        ...aiModule,
        streamText: createMockStreamResult(capturedMessages),
      }));

      const mockModel = createAnthropicMockModel();
      const agent = new AISDKAgent({
        model: mockModel,
        // System prompt with 1h TTL, last message with 5m TTL
        cacheBreakpoint: (msg) => {
          if (msg.role === 'system') return '1h';
          if (msg.isLast) return '5m';
          return false;
        },
      });

      const emittedEvents: AGUIEvent[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      const input = createTestInput({
        systemPrompt: 'You are a helpful assistant.',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
          { role: 'user', content: 'How are you?' },
        ],
      });

      await agent.run(input, eventEmitter);

      // Should have 4 messages
      expect(capturedMessages.messages.length).toBe(4);

      // System message should have 1h TTL
      const systemMsg = capturedMessages.messages[0] as {
        role: string;
        providerOptions?: { anthropic?: { cacheControl?: { type: string; ttl?: string } } }
      };
      expect(systemMsg.role).toBe('system');
      expect(systemMsg.providerOptions?.anthropic?.cacheControl?.type).toBe('ephemeral');
      expect(systemMsg.providerOptions?.anthropic?.cacheControl?.ttl).toBe('1h');

      // Middle messages should not have cache control
      const msg1 = capturedMessages.messages[1] as { providerOptions?: unknown };
      const msg2 = capturedMessages.messages[2] as { providerOptions?: unknown };
      expect(msg1.providerOptions).toBeUndefined();
      expect(msg2.providerOptions).toBeUndefined();

      // Last message should have 5m TTL
      const lastMsg = capturedMessages.messages[3] as {
        role: string;
        providerOptions?: { anthropic?: { cacheControl?: { type: string; ttl?: string } } }
      };
      expect(lastMsg.role).toBe('user');
      expect(lastMsg.providerOptions?.anthropic?.cacheControl?.type).toBe('ephemeral');
      expect(lastMsg.providerOptions?.anthropic?.cacheControl?.ttl).toBe('5m');

      mock.module('ai', () => ({
        ...aiModule,
        streamText: originalStreamText,
      }));
    });

    test('cacheBreakpoint with true: adds cache control without TTL (default 5m)', async () => {
      const capturedMessages = { messages: [] as unknown[] };
      const aiModule = await import('ai');
      const originalStreamText = aiModule.streamText;

      mock.module('ai', () => ({
        ...aiModule,
        streamText: createMockStreamResult(capturedMessages),
      }));

      const mockModel = createAnthropicMockModel();
      const agent = new AISDKAgent({
        model: mockModel,
        // Return true (not TTL string) - should not include ttl field
        cacheBreakpoint: (msg) => msg.role === 'system',
      });

      const emittedEvents: AGUIEvent[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      const input = createTestInput({
        systemPrompt: 'You are a helpful assistant.',
      });

      await agent.run(input, eventEmitter);

      // System message should have cache control WITHOUT ttl field (Anthropic defaults to 5m)
      const systemMsg = capturedMessages.messages[0] as {
        role: string;
        providerOptions?: { anthropic?: { cacheControl?: { type: string; ttl?: string } } }
      };
      expect(systemMsg.role).toBe('system');
      expect(systemMsg.providerOptions?.anthropic?.cacheControl?.type).toBe('ephemeral');
      // ttl field should not be present when returning true
      expect(systemMsg.providerOptions?.anthropic?.cacheControl?.ttl).toBeUndefined();

      mock.module('ai', () => ({
        ...aiModule,
        streamText: originalStreamText,
      }));
    });
  });
});
